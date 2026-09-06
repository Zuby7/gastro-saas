import { beforeEach, describe, expect, it, vi } from "vitest";

const createCheckoutSessionMock = vi.fn();
const recordOrderAuditEventMock = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  createStripeClient: () => ({
    checkout: { sessions: { create: (...args: unknown[]) => createCheckoutSessionMock(...args) } },
  }),
}));

vi.mock("@/lib/audit/record-order-audit-event", () => ({
  recordOrderAuditEvent: (...args: unknown[]) => recordOrderAuditEventMock(...args),
}));

interface FakeState {
  order: {
    id: string;
    tenant_id: string;
    status: string;
    total_cents: number;
    currency: string;
  } | null;
  paymentAccount: { stripe_account_id: string; charges_enabled: boolean } | null;
  paymentsInsertError: { code: string; message: string } | null;
}

let state: FakeState;
const paymentsInsertCalls: unknown[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: state.order,
                  error: state.order ? null : { message: "not found" },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "payment_accounts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: state.paymentAccount, error: null }),
            }),
          }),
        };
      }
      if (table === "payments") {
        return {
          insert: async (payload: unknown) => {
            paymentsInsertCalls.push(payload);
            return { error: state.paymentsInsertError };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  paymentsInsertCalls.length = 0;
  state = {
    order: {
      id: "order-1",
      tenant_id: "tenant-1",
      status: "awaiting_payment",
      total_cents: 2599,
      currency: "EUR",
    },
    paymentAccount: { stripe_account_id: "acct_123", charges_enabled: true },
    paymentsInsertError: null,
  };
  createCheckoutSessionMock.mockResolvedValue({
    id: "cs_test_abc",
    url: "https://checkout.stripe.com/c/pay/cs_test_abc",
    payment_intent: "pi_test_abc",
  });
});

describe("isTenantChargeReady", () => {
  it("returns true only when payment_accounts.charges_enabled is true", async () => {
    const { isTenantChargeReady } = await import("./service");
    await expect(isTenantChargeReady("tenant-1")).resolves.toBe(true);

    state.paymentAccount = { stripe_account_id: "acct_123", charges_enabled: false };
    await expect(isTenantChargeReady("tenant-1")).resolves.toBe(false);

    state.paymentAccount = null;
    await expect(isTenantChargeReady("tenant-1")).resolves.toBe(false);
  });
});

describe("createCheckoutSessionForOrder", () => {
  it("creates a destination-charge Checkout Session using the order's own immutable total, never a caller-supplied amount", async () => {
    const { createCheckoutSessionForOrder } = await import("./service");

    const result = await createCheckoutSessionForOrder({
      tenantId: "tenant-1",
      tenantSlug: "demo",
      orderId: "order-1",
      guestAccessToken: "raw-token",
    });

    expect(result.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_abc");

    const [params] = createCheckoutSessionMock.mock.calls[0] as [
      {
        line_items: Array<{ price_data: { unit_amount: number; currency: string } }>;
        payment_intent_data: { on_behalf_of: string; transfer_data: { destination: string } };
        success_url: string;
        cancel_url: string;
        expires_at: number;
      },
    ];
    expect(params.line_items[0]!.price_data.unit_amount).toBe(2599);
    expect(params.line_items[0]!.price_data.currency).toBe("eur");
    expect(params.payment_intent_data.on_behalf_of).toBe("acct_123");
    expect(params.payment_intent_data.transfer_data.destination).toBe("acct_123");
    expect(params.success_url).toContain("/r/demo/orders/raw-token");
    expect(params.cancel_url).toContain("/r/demo/orders/raw-token");

    // Issue #88: Stripe's own session expiry must line up with the
    // awaiting-payment timeout sweep's default (30 minutes), not Stripe's
    // 24-hour default, so a guest can't pay hours after the sweep already
    // cancelled the order.
    const nowSeconds = Math.floor(Date.now() / 1000);
    expect(params.expires_at).toBeGreaterThanOrEqual(nowSeconds + 30 * 60 - 5);
    expect(params.expires_at).toBeLessThanOrEqual(nowSeconds + 30 * 60 + 5);

    expect(paymentsInsertCalls[0]).toMatchObject({
      tenant_id: "tenant-1",
      order_id: "order-1",
      stripe_checkout_session_id: "cs_test_abc",
      stripe_payment_intent_id: "pi_test_abc",
      stripe_account_id: "acct_123",
      amount_cents: 2599,
      currency: "EUR",
    });

    expect(recordOrderAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "tenant-1",
        action: "payment_started",
        targetId: "order-1",
      }),
    );
  });

  it("sends an Idempotency-Key derived solely from the order id, so a retry can never create two Stripe sessions", async () => {
    const { createCheckoutSessionForOrder } = await import("./service");

    await createCheckoutSessionForOrder({
      tenantId: "tenant-1",
      tenantSlug: "demo",
      orderId: "order-1",
      guestAccessToken: "raw-token",
    });

    const [, options] = createCheckoutSessionMock.mock.calls[0] as [
      unknown,
      { idempotencyKey: string },
    ];
    expect(options.idempotencyKey).toBe("checkout-session:order-1");
  });

  it("tolerates a duplicate-session insert (Stripe idempotent replay) without throwing", async () => {
    state.paymentsInsertError = { code: "23505", message: "duplicate key value" };

    const { createCheckoutSessionForOrder } = await import("./service");

    await expect(
      createCheckoutSessionForOrder({
        tenantId: "tenant-1",
        tenantSlug: "demo",
        orderId: "order-1",
        guestAccessToken: "raw-token",
      }),
    ).resolves.toMatchObject({ checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_abc" });
  });

  it("rejects a non-duplicate payments-insert failure (e.g. the DB-level amount/readiness guard)", async () => {
    state.paymentsInsertError = { code: "23514", message: "check_violation" };

    const { createCheckoutSessionForOrder } = await import("./service");

    await expect(
      createCheckoutSessionForOrder({
        tenantId: "tenant-1",
        tenantSlug: "demo",
        orderId: "order-1",
        guestAccessToken: "raw-token",
      }),
    ).rejects.toThrow();
  });

  it("refuses to create a payment session when the tenant's Connect account is not charge-ready", async () => {
    state.paymentAccount = { stripe_account_id: "acct_123", charges_enabled: false };

    const { createCheckoutSessionForOrder } = await import("./service");

    await expect(
      createCheckoutSessionForOrder({
        tenantId: "tenant-1",
        tenantSlug: "demo",
        orderId: "order-1",
        guestAccessToken: "raw-token",
      }),
    ).rejects.toThrow(/nicht verfügbar/);
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("refuses to create a payment session when there is no connected account at all", async () => {
    state.paymentAccount = null;

    const { createCheckoutSessionForOrder } = await import("./service");

    await expect(
      createCheckoutSessionForOrder({
        tenantId: "tenant-1",
        tenantSlug: "demo",
        orderId: "order-1",
        guestAccessToken: "raw-token",
      }),
    ).rejects.toThrow(/nicht verfügbar/);
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("refuses to create a payment session for an order that is not awaiting_payment", async () => {
    state.order = { ...state.order!, status: "cancelled" };

    const { createCheckoutSessionForOrder } = await import("./service");

    await expect(
      createCheckoutSessionForOrder({
        tenantId: "tenant-1",
        tenantSlug: "demo",
        orderId: "order-1",
        guestAccessToken: "raw-token",
      }),
    ).rejects.toThrow("not awaiting payment");
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("never trusts a caller-supplied total: the Checkout Session amount always comes from the order's own DB row", async () => {
    // Even though nothing in this input carries a total, this test asserts
    // the contract explicitly: CreateCheckoutSessionInput has no
    // amount/total field at all, so there is no parallel path to trust.
    const { createCheckoutSessionForOrder } = await import("./service");
    state.order = { ...state.order!, total_cents: 999999 };

    await createCheckoutSessionForOrder({
      tenantId: "tenant-1",
      tenantSlug: "demo",
      orderId: "order-1",
      guestAccessToken: "raw-token",
    });

    const [params] = createCheckoutSessionMock.mock.calls[0] as [
      { line_items: Array<{ price_data: { unit_amount: number } }> },
    ];
    expect(params.line_items[0]!.price_data.unit_amount).toBe(999999);
  });
});
