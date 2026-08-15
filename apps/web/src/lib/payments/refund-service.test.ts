import { beforeEach, describe, expect, it, vi } from "vitest";

const stripeRefundsCreateMock = vi.fn();
const recordMenuAdminAuditEventMock = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  createStripeClient: () => ({
    refunds: { create: (...args: unknown[]) => stripeRefundsCreateMock(...args) },
  }),
}));

vi.mock("@/lib/audit/record-menu-admin-audit-event", () => ({
  recordMenuAdminAuditEvent: (...args: unknown[]) => recordMenuAdminAuditEventMock(...args),
}));

interface FakePayment {
  id: string;
  tenant_id: string;
  order_id: string;
  stripe_payment_intent_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
}

interface FakeRefundRow {
  id: string;
  amount_cents: number;
  currency: string;
  reason: string;
  status: string;
  stripe_refund_id: string | null;
  actor_user_id: string;
  created_at: string;
}

interface State {
  payment: FakePayment | null;
  refunds: FakeRefundRow[];
  refundsInsertError: { message: string } | null;
  refundIdCounter: number;
}

let state: State;
let updateCalls: Array<{ id: string; payload: Record<string, unknown> }>;
let insertedRefund: Record<string, unknown> | undefined;

function fakeSupabase() {
  return {
    from(table: string) {
      if (table === "payments") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({ data: state.payment, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "refunds") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                returns: async () => ({ data: state.refunds, error: null }),
                order: () => ({
                  returns: async () => ({ data: state.refunds, error: null }),
                }),
              }),
            }),
          }),
          insert: (payload: Record<string, unknown>) => {
            insertedRefund = payload;
            return {
              select: () => ({
                single: async () => {
                  if (state.refundsInsertError) {
                    return { data: null, error: state.refundsInsertError };
                  }
                  const id = `refund-${state.refundIdCounter++}`;
                  return { data: { id }, error: null };
                },
              }),
            };
          },
          update: (payload: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              updateCalls.push({ id, payload });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls = [];
  insertedRefund = undefined;
  state = {
    payment: {
      id: "payment-1",
      tenant_id: "tenant-1",
      order_id: "order-1",
      stripe_payment_intent_id: "pi_test_abc",
      amount_cents: 2000,
      currency: "EUR",
      status: "paid",
    },
    refunds: [],
    refundsInsertError: null,
    refundIdCounter: 1,
  };
  stripeRefundsCreateMock.mockResolvedValue({ id: "re_test_abc" });
});

describe("issueRefundForOrder", () => {
  it("issues a full refund with reverse_transfer set (destination-charge clawback) and writes an audit entry", async () => {
    const { issueRefundForOrder } = await import("./refund-service");

    const result = await issueRefundForOrder(fakeSupabase() as never, {
      tenantId: "tenant-1",
      orderId: "order-1",
      actorUserId: "user-1",
      amountCents: 2000,
      reason: "Kunde unzufrieden",
    });

    expect(result.stripeRefundId).toBe("re_test_abc");
    expect(insertedRefund).toMatchObject({
      tenant_id: "tenant-1",
      payment_id: "payment-1",
      order_id: "order-1",
      amount_cents: 2000,
      currency: "EUR",
      reason: "Kunde unzufrieden",
      actor_user_id: "user-1",
      status: "pending",
    });

    const [params, options] = stripeRefundsCreateMock.mock.calls[0] as [
      { payment_intent: string; amount: number; reverse_transfer: boolean },
      { idempotencyKey: string },
    ];
    expect(params.payment_intent).toBe("pi_test_abc");
    expect(params.amount).toBe(2000);
    expect(params.reverse_transfer).toBe(true);
    expect(options.idempotencyKey).toContain("refund-");

    expect(updateCalls[0]).toMatchObject({
      payload: { status: "succeeded", stripe_refund_id: "re_test_abc" },
    });

    expect(recordMenuAdminAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "tenant-1",
        actorUserId: "user-1",
        action: "payment.refund_succeeded",
        targetType: "order",
        targetId: "order-1",
        metadata: expect.objectContaining({
          amountCents: 2000,
          reason: "Kunde unzufrieden",
          stripeRefundId: "re_test_abc",
        }),
      }),
    );
  });

  it("issues a partial refund for less than the full paid amount", async () => {
    const { issueRefundForOrder } = await import("./refund-service");

    const result = await issueRefundForOrder(fakeSupabase() as never, {
      tenantId: "tenant-1",
      orderId: "order-1",
      actorUserId: "user-1",
      amountCents: 500,
      reason: "Ein Gericht fehlte",
    });

    expect(result.amountCents).toBe(500);
    expect(insertedRefund).toMatchObject({ amount_cents: 500 });
  });

  it("supports multiple partial refunds against the same payment, summing correctly", async () => {
    state.refunds = [
      {
        id: "refund-0",
        amount_cents: 700,
        currency: "EUR",
        reason: "erste Teilerstattung",
        status: "succeeded",
        stripe_refund_id: "re_prev",
        actor_user_id: "user-1",
        created_at: new Date().toISOString(),
      },
    ];

    const { issueRefundForOrder } = await import("./refund-service");

    // 700 already refunded + 1300 requested = 2000, exactly the paid amount.
    const result = await issueRefundForOrder(fakeSupabase() as never, {
      tenantId: "tenant-1",
      orderId: "order-1",
      actorUserId: "user-1",
      amountCents: 1300,
      reason: "Rest erstatten",
    });

    expect(result.amountCents).toBe(1300);
  });

  it("rejects a refund that would exceed the remaining refundable amount, without calling Stripe", async () => {
    state.refunds = [
      {
        id: "refund-0",
        amount_cents: 1600,
        currency: "EUR",
        reason: "erste Teilerstattung",
        status: "succeeded",
        stripe_refund_id: "re_prev",
        actor_user_id: "user-1",
        created_at: new Date().toISOString(),
      },
    ];

    const { issueRefundForOrder, RefundExceedsRemainingAmountError } = await import(
      "./refund-service"
    );

    await expect(
      issueRefundForOrder(fakeSupabase() as never, {
        tenantId: "tenant-1",
        orderId: "order-1",
        actorUserId: "user-1",
        amountCents: 500,
        reason: "Zu viel verlangt",
      }),
    ).rejects.toBeInstanceOf(RefundExceedsRemainingAmountError);

    expect(stripeRefundsCreateMock).not.toHaveBeenCalled();
    expect(insertedRefund).toBeUndefined();
  });

  it("rejects a refund exceeding the full paid amount even as a single request", async () => {
    const { issueRefundForOrder, RefundExceedsRemainingAmountError } = await import(
      "./refund-service"
    );

    await expect(
      issueRefundForOrder(fakeSupabase() as never, {
        tenantId: "tenant-1",
        orderId: "order-1",
        actorUserId: "user-1",
        amountCents: 5000,
        reason: "zu viel",
      }),
    ).rejects.toBeInstanceOf(RefundExceedsRemainingAmountError);
    expect(stripeRefundsCreateMock).not.toHaveBeenCalled();
  });

  it("surfaces the DB-level 'exceed' guard as the same typed error if the app-level pre-check is somehow bypassed", async () => {
    state.refundsInsertError = { message: "would exceed the paid amount 2000 for payment x" };

    const { issueRefundForOrder, RefundExceedsRemainingAmountError } = await import(
      "./refund-service"
    );

    await expect(
      issueRefundForOrder(fakeSupabase() as never, {
        tenantId: "tenant-1",
        orderId: "order-1",
        actorUserId: "user-1",
        amountCents: 100,
        reason: "grund",
      }),
    ).rejects.toBeInstanceOf(RefundExceedsRemainingAmountError);
    expect(stripeRefundsCreateMock).not.toHaveBeenCalled();
  });

  it("throws PaymentNotRefundableError when the order has no paid payment", async () => {
    state.payment = null;

    const { issueRefundForOrder, PaymentNotRefundableError } = await import("./refund-service");

    await expect(
      issueRefundForOrder(fakeSupabase() as never, {
        tenantId: "tenant-1",
        orderId: "order-1",
        actorUserId: "user-1",
        amountCents: 100,
        reason: "grund",
      }),
    ).rejects.toBeInstanceOf(PaymentNotRefundableError);
    expect(stripeRefundsCreateMock).not.toHaveBeenCalled();
  });

  it("marks the refund row 'failed' and still writes an audit entry when the Stripe call itself fails", async () => {
    stripeRefundsCreateMock.mockRejectedValue(new Error("Stripe is down"));

    const { issueRefundForOrder } = await import("./refund-service");

    await expect(
      issueRefundForOrder(fakeSupabase() as never, {
        tenantId: "tenant-1",
        orderId: "order-1",
        actorUserId: "user-1",
        amountCents: 500,
        reason: "grund",
      }),
    ).rejects.toThrow(/nicht durchgeführt werden/);

    expect(updateCalls[0]).toMatchObject({ payload: { status: "failed" } });
    expect(recordMenuAdminAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "payment.refund_failed" }),
    );
  });

  it("rejects a zero or negative refund amount before ever touching the database", async () => {
    const { issueRefundForOrder, RefundInvalidAmountError } = await import("./refund-service");

    await expect(
      issueRefundForOrder(fakeSupabase() as never, {
        tenantId: "tenant-1",
        orderId: "order-1",
        actorUserId: "user-1",
        amountCents: 0,
        reason: "grund",
      }),
    ).rejects.toBeInstanceOf(RefundInvalidAmountError);
    expect(stripeRefundsCreateMock).not.toHaveBeenCalled();
  });
});

describe("getPaymentRefundSummary", () => {
  it("returns null when the order has no paid payment", async () => {
    state.payment = null;
    const { getPaymentRefundSummary } = await import("./refund-service");

    await expect(
      getPaymentRefundSummary(fakeSupabase() as never, { tenantId: "tenant-1", orderId: "order-1" }),
    ).resolves.toBeNull();
  });

  it("computes the remaining refundable amount from pending+succeeded refunds only", async () => {
    state.refunds = [
      {
        id: "refund-0",
        amount_cents: 500,
        currency: "EUR",
        reason: "erste Teilerstattung",
        status: "succeeded",
        stripe_refund_id: "re_a",
        actor_user_id: "user-1",
        created_at: new Date().toISOString(),
      },
      {
        id: "refund-1",
        amount_cents: 300,
        currency: "EUR",
        reason: "gescheiterter Versuch",
        status: "failed",
        stripe_refund_id: null,
        actor_user_id: "user-1",
        created_at: new Date().toISOString(),
      },
    ];

    const { getPaymentRefundSummary } = await import("./refund-service");
    const summary = await getPaymentRefundSummary(fakeSupabase() as never, {
      tenantId: "tenant-1",
      orderId: "order-1",
    });

    expect(summary).not.toBeNull();
    // Only the succeeded 500 counts against the paid 2000 -- the failed 300
    // does not reserve any of the remaining refundable amount.
    expect(summary!.refundedOrReservedCents).toBe(500);
    expect(summary!.remainingRefundableCents).toBe(1500);
    expect(summary!.refunds).toHaveLength(2);
  });
});
