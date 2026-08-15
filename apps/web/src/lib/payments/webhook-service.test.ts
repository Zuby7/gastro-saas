import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const recordOrderAuditEventMock = vi.fn();

vi.mock("@/lib/audit/record-order-audit-event", () => ({
  recordOrderAuditEvent: (...args: unknown[]) => recordOrderAuditEventMock(...args),
}));

interface FakeOrder {
  id: string;
  tenant_id: string;
  status: string;
  total_cents: number;
  currency: string;
}

interface FakePayment {
  id: string;
  tenant_id: string;
  order_id: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
  stripe_account_id: string;
  amount_cents: number;
  currency: string;
  status: string;
}

interface FakeState {
  order: FakeOrder | null;
  payment: FakePayment | null;
  tenantStripeAccountId: string | null;
  orderStatusEventInsertError: { message: string } | null;
}

let state: FakeState;
const orderStatusEventInserts: unknown[] = [];
const paymentUpdates: unknown[] = [];

function resetState() {
  state = {
    order: {
      id: "order-1",
      tenant_id: "tenant-1",
      status: "awaiting_payment",
      total_cents: 2599,
      currency: "EUR",
    },
    payment: {
      id: "payment-1",
      tenant_id: "tenant-1",
      order_id: "order-1",
      stripe_checkout_session_id: "cs_test_abc",
      stripe_payment_intent_id: "pi_test_abc",
      stripe_account_id: "acct_123",
      amount_cents: 2599,
      currency: "EUR",
      status: "pending",
    },
    tenantStripeAccountId: "acct_123",
    orderStatusEventInsertError: null,
  };
  orderStatusEventInserts.length = 0;
  paymentUpdates.length = 0;
}

function makeAdmin() {
  return {
    from(table: string) {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: state.order,
                error: state.order ? null : { message: "not found" },
              }),
            }),
          }),
        };
      }
      if (table === "payments") {
        return {
          select: () => ({
            eq: (column: string, value: string) => ({
              maybeSingle: async () => {
                if (!state.payment) return { data: null, error: { message: "not found" } };
                const match =
                  (column === "stripe_checkout_session_id" &&
                    state.payment.stripe_checkout_session_id === value) ||
                  (column === "stripe_payment_intent_id" &&
                    state.payment.stripe_payment_intent_id === value);
                return match
                  ? { data: state.payment, error: null }
                  : { data: null, error: { message: "not found" } };
              },
            }),
          }),
          update: (payload: unknown) => {
            paymentUpdates.push(payload);
            return {
              eq: async () => {
                if (state.payment) Object.assign(state.payment, mapUpdatePayload(payload));
                return { error: null };
              },
            };
          },
        };
      }
      if (table === "payment_accounts") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: state.tenantStripeAccountId
                  ? { stripe_account_id: state.tenantStripeAccountId }
                  : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "order_status_events") {
        return {
          insert: async (payload: unknown) => {
            orderStatusEventInserts.push(payload);
            if (state.orderStatusEventInsertError) {
              return { error: state.orderStatusEventInsertError };
            }
            if (state.order) {
              const p = payload as { to_status: string };
              state.order.status = p.to_status;
            }
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

function mapUpdatePayload(payload: unknown): Partial<FakePayment> {
  const p = payload as Record<string, unknown>;
  const out: Partial<FakePayment> = {};
  if (typeof p.status === "string") out.status = p.status;
  if (typeof p.stripe_payment_intent_id === "string" || p.stripe_payment_intent_id === null) {
    out.stripe_payment_intent_id = p.stripe_payment_intent_id as string | null;
  }
  return out;
}

function checkoutSessionCompletedEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    account: null,
    data: {
      object: {
        id: "cs_test_abc",
        payment_status: "paid",
        amount_total: 2599,
        currency: "eur",
        payment_intent: "pi_test_abc",
        metadata: { tenant_id: "tenant-1", order_id: "order-1" },
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

function checkoutSessionExpiredEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: "evt_expired_1",
    type: "checkout.session.expired",
    account: null,
    data: {
      object: {
        id: "cs_test_abc",
        metadata: { tenant_id: "tenant-1", order_id: "order-1" },
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

function paymentIntentFailedEvent(overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: "evt_failed_1",
    type: "payment_intent.payment_failed",
    account: null,
    data: {
      object: {
        id: "pi_test_abc",
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
});

describe("handleStripePaymentWebhookEvent -- checkout.session.completed (success)", () => {
  it("marks the order received and the payment paid on a verified, matching event", async () => {
    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();

    await handleStripePaymentWebhookEvent(admin as never, checkoutSessionCompletedEvent());

    expect(orderStatusEventInserts).toEqual([
      expect.objectContaining({
        tenant_id: "tenant-1",
        order_id: "order-1",
        from_status: "awaiting_payment",
        to_status: "received",
      }),
    ]);
    expect(state.order?.status).toBe("received");
    expect(state.payment?.status).toBe("paid");
    expect(recordOrderAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "payment_confirmed", targetId: "order-1" }),
    );
  });

  it("is idempotent: processing the identical event twice only transitions the order once", async () => {
    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();
    const event = checkoutSessionCompletedEvent();

    await handleStripePaymentWebhookEvent(admin as never, event);
    // Second delivery: order is now "received", not "awaiting_payment".
    await handleStripePaymentWebhookEvent(admin as never, event);

    expect(orderStatusEventInserts).toHaveLength(1);
    expect(
      recordOrderAuditEventMock.mock.calls.filter(
        (call) => call[1]?.action === "payment_confirmed",
      ),
    ).toHaveLength(1);
  });
});

describe("handleStripePaymentWebhookEvent -- amount mismatch", () => {
  it("leaves the order unpaid, flags the payment for review, and does not transition the order", async () => {
    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();

    await handleStripePaymentWebhookEvent(
      admin as never,
      checkoutSessionCompletedEvent({ amount_total: 1 }),
    );

    expect(orderStatusEventInserts).toHaveLength(0);
    expect(state.order?.status).toBe("awaiting_payment");
    expect(state.payment?.status).toBe("flagged_for_review");
    expect(recordOrderAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "payment_amount_mismatch_flagged" }),
    );
  });
});

describe("handleStripePaymentWebhookEvent -- tenant/connected-account mismatch", () => {
  it("flags and does not process when the tenant's own recorded Stripe account does not match the payment's", async () => {
    state.tenantStripeAccountId = "acct_different";

    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();

    await handleStripePaymentWebhookEvent(admin as never, checkoutSessionCompletedEvent());

    expect(orderStatusEventInserts).toHaveLength(0);
    expect(state.order?.status).toBe("awaiting_payment");
    expect(state.payment?.status).toBe("flagged_for_review");
    expect(recordOrderAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "payment_webhook_tenant_mismatch_flagged" }),
    );
  });

  it("flags and does not process when the event's own connected-account field does not match", async () => {
    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();

    await handleStripePaymentWebhookEvent(
      admin as never,
      { ...checkoutSessionCompletedEvent(), account: "acct_attacker" } as Stripe.Event,
    );

    expect(orderStatusEventInserts).toHaveLength(0);
    expect(state.payment?.status).toBe("flagged_for_review");
  });

  it("flags and does not process when the session metadata claims a different order/tenant", async () => {
    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();

    await handleStripePaymentWebhookEvent(
      admin as never,
      checkoutSessionCompletedEvent({
        metadata: { tenant_id: "tenant-evil", order_id: "order-1" },
      }),
    );

    expect(orderStatusEventInserts).toHaveLength(0);
    expect(state.payment?.status).toBe("flagged_for_review");
  });
});

describe("handleStripePaymentWebhookEvent -- out-of-order / stale events", () => {
  it("ignores a delayed success event for an order that has already moved on (e.g. already cancelled)", async () => {
    state.order!.status = "cancelled";

    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();

    await handleStripePaymentWebhookEvent(admin as never, checkoutSessionCompletedEvent());

    expect(orderStatusEventInserts).toHaveLength(0);
    expect(state.order?.status).toBe("cancelled");
    expect(state.payment?.status).toBe("pending");
  });

  it("ignores a stale expiry for an order that already succeeded", async () => {
    state.order!.status = "received";

    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();

    await handleStripePaymentWebhookEvent(admin as never, checkoutSessionExpiredEvent());

    expect(orderStatusEventInserts).toHaveLength(0);
    expect(state.order?.status).toBe("received");
  });
});

describe("handleStripePaymentWebhookEvent -- checkout.session.expired", () => {
  it("cancels the order and marks the payment cancelled", async () => {
    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();

    await handleStripePaymentWebhookEvent(admin as never, checkoutSessionExpiredEvent());

    expect(orderStatusEventInserts).toEqual([
      expect.objectContaining({ from_status: "awaiting_payment", to_status: "cancelled" }),
    ]);
    expect(state.order?.status).toBe("cancelled");
    expect(state.payment?.status).toBe("cancelled");
    expect(recordOrderAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "payment_session_expired" }),
    );
  });
});

describe("handleStripePaymentWebhookEvent -- payment_intent.payment_failed", () => {
  it("cancels the order and marks the payment failed", async () => {
    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();

    await handleStripePaymentWebhookEvent(admin as never, paymentIntentFailedEvent());

    expect(orderStatusEventInserts).toEqual([
      expect.objectContaining({ from_status: "awaiting_payment", to_status: "cancelled" }),
    ]);
    expect(state.order?.status).toBe("cancelled");
    expect(state.payment?.status).toBe("failed");
    expect(recordOrderAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "payment_failed" }),
    );
  });

  it("does nothing (acknowledged) when no payments row matches the payment intent id", async () => {
    state.payment = null;

    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();

    await expect(
      handleStripePaymentWebhookEvent(admin as never, paymentIntentFailedEvent()),
    ).resolves.toBeUndefined();
    expect(orderStatusEventInserts).toHaveLength(0);
  });
});

describe("handleStripePaymentWebhookEvent -- unhandled event types", () => {
  it("is a no-op for event types this handler does not understand", async () => {
    const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
    const admin = makeAdmin();

    await handleStripePaymentWebhookEvent(
      admin as never,
      {
        id: "evt_other",
        type: "charge.refunded",
        data: { object: {} },
      } as unknown as Stripe.Event,
    );

    expect(orderStatusEventInserts).toHaveLength(0);
    expect(recordOrderAuditEventMock).not.toHaveBeenCalled();
  });
});
