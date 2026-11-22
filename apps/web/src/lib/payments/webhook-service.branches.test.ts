import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

/**
 * Additional branch coverage for webhook-service.ts (the base scenarios live
 * in webhook-service.test.ts): missing/mismatched rows for every handler,
 * unpaid sessions, currency mismatch, RPC failure/decline, cancellation
 * insert failure, and the confirmation-email defense-in-depth catch.
 */

const recordOrderAuditEventMock = vi.fn();
const sendOrderConfirmationEmailMock = vi.fn();

vi.mock("@/lib/audit/record-order-audit-event", () => ({
  recordOrderAuditEvent: (...args: unknown[]) => recordOrderAuditEventMock(...args),
}));

vi.mock("@/lib/notifications/order-confirmation-email", () => ({
  sendOrderConfirmationEmail: (...args: unknown[]) => sendOrderConfirmationEmailMock(...args),
}));

interface Scenario {
  order: Record<string, unknown> | null;
  payment: Record<string, unknown> | null;
  tenantStripeAccountId: string | null;
  rpcResult: { data: boolean | null; error: { message: string } | null };
  eventInsertError: { message: string } | null;
  /** Issue #204: simulated transient DB failures, keyed by table name. */
  lookupErrors: Partial<Record<"orders" | "payments" | "payment_accounts", { message: string }>>;
  paymentUpdateError: { message: string } | null;
}

let scenario: Scenario;
const paymentUpdates: unknown[] = [];
const eventInserts: unknown[] = [];
const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];

function reset() {
  scenario = {
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
    rpcResult: { data: true, error: null },
    eventInsertError: null,
    lookupErrors: {},
    paymentUpdateError: null,
  };
  paymentUpdates.length = 0;
  eventInserts.length = 0;
  rpcCalls.length = 0;
}

function makeAdmin() {
  return {
    from(table: string) {
      switch (table) {
        case "orders":
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () =>
                  scenario.lookupErrors.orders
                    ? { data: null, error: scenario.lookupErrors.orders }
                    : { data: scenario.order, error: null },
              }),
            }),
          };
        case "payments":
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () =>
                  scenario.lookupErrors.payments
                    ? { data: null, error: scenario.lookupErrors.payments }
                    : { data: scenario.payment, error: null },
              }),
            }),
            update: (payload: unknown) => {
              paymentUpdates.push(payload);
              return { eq: async () => ({ error: scenario.paymentUpdateError }) };
            },
          };
        case "payment_accounts":
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () =>
                  scenario.lookupErrors.payment_accounts
                    ? { data: null, error: scenario.lookupErrors.payment_accounts }
                    : {
                        data: scenario.tenantStripeAccountId
                          ? { stripe_account_id: scenario.tenantStripeAccountId }
                          : null,
                        error: null,
                      },
              }),
            }),
          };
        case "order_status_events":
          return {
            insert: async (payload: unknown) => {
              eventInserts.push(payload);
              return { error: scenario.eventInsertError };
            },
          };
        default:
          throw new Error(`Unexpected table ${table}`);
      }
    },
    rpc: async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return scenario.rpcResult;
    },
  };
}

function completed(
  sessionOverrides: Record<string, unknown> = {},
  eventOverrides: Record<string, unknown> = {},
): Stripe.Event {
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
        customer_details: { email: "guest@example.com" },
        metadata: { tenant_id: "tenant-1", order_id: "order-1" },
        ...sessionOverrides,
      },
    },
    ...eventOverrides,
  } as unknown as Stripe.Event;
}

function expired(
  sessionOverrides: Record<string, unknown> = {},
  eventOverrides: Record<string, unknown> = {},
): Stripe.Event {
  return {
    id: "evt_exp",
    type: "checkout.session.expired",
    account: null,
    data: {
      object: {
        id: "cs_test_abc",
        metadata: { tenant_id: "tenant-1", order_id: "order-1" },
        ...sessionOverrides,
      },
    },
    ...eventOverrides,
  } as unknown as Stripe.Event;
}

function failed(eventOverrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id: "evt_fail",
    type: "payment_intent.payment_failed",
    account: null,
    data: { object: { id: "pi_test_abc" } },
    ...eventOverrides,
  } as unknown as Stripe.Event;
}

async function handle(event: Stripe.Event) {
  const { handleStripePaymentWebhookEvent } = await import("./webhook-service");
  return handleStripePaymentWebhookEvent(makeAdmin() as never, event);
}

function auditActions(): string[] {
  return recordOrderAuditEventMock.mock.calls.map((call) => (call[1] as { action: string }).action);
}

beforeEach(() => {
  vi.clearAllMocks();
  reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkout.session.completed -- unresolvable rows", () => {
  it("acknowledges and changes nothing when no payments row matches the session", async () => {
    scenario.payment = null;
    await expect(handle(completed())).resolves.toBeUndefined();
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toHaveLength(0);
  });

  it("acknowledges and changes nothing when the order does not exist", async () => {
    scenario.order = null;
    await expect(handle(completed())).resolves.toBeUndefined();
    expect(rpcCalls).toHaveLength(0);
  });

  it("refuses to process when the order belongs to a different tenant than the payment", async () => {
    scenario.order!.tenant_id = "tenant-2";
    await handle(completed());
    expect(rpcCalls).toHaveLength(0);
    expect(recordOrderAuditEventMock).not.toHaveBeenCalled();
  });
});

describe("checkout.session.completed -- payment state", () => {
  it("does nothing yet for a session that is not paid (async payment method pending)", async () => {
    await handle(completed({ payment_status: "unpaid" }));
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toHaveLength(0);
    expect(recordOrderAuditEventMock).not.toHaveBeenCalled();
  });

  it("flags a currency mismatch even when the amount matches", async () => {
    await handle(completed({ currency: "usd" }));
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toEqual([{ status: "flagged_for_review" }]);
    expect(auditActions()).toEqual(["payment_amount_mismatch_flagged"]);
  });

  it("flags a missing amount_total instead of trusting the event", async () => {
    await handle(completed({ amount_total: null }));
    expect(rpcCalls).toHaveLength(0);
    expect(auditActions()).toEqual(["payment_amount_mismatch_flagged"]);
  });

  it("flags a mismatch when the order total changed after the session was created", async () => {
    scenario.order!.total_cents = 3000;
    await handle(completed());
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toEqual([{ status: "flagged_for_review" }]);
  });

  it("does not flag a cancelled order when the session is not paid", async () => {
    scenario.order!.status = "cancelled";
    await handle(completed({ payment_status: "unpaid" }));
    expect(paymentUpdates).toHaveLength(0);
  });

  it("uses the payment's stored intent id when the session carries none, and no email when absent", async () => {
    sendOrderConfirmationEmailMock.mockResolvedValue(undefined);
    await handle(completed({ payment_intent: null, customer_details: null, customer_email: null }));
    expect(rpcCalls[0]!.params).toMatchObject({
      p_stripe_payment_intent_id: "pi_test_abc",
      p_tenant_id: "tenant-1",
      p_order_id: "order-1",
      p_payment_id: "payment-1",
    });
    expect(sendOrderConfirmationEmailMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recipientEmail: null }),
    );
  });

  it("falls back to session.customer_email for the confirmation email", async () => {
    sendOrderConfirmationEmailMock.mockResolvedValue(undefined);
    await handle(completed({ customer_details: null, customer_email: "fallback@example.com" }));
    expect(sendOrderConfirmationEmailMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ recipientEmail: "fallback@example.com" }),
    );
  });

  it("ignores non-string metadata ids rather than treating them as a mismatch", async () => {
    sendOrderConfirmationEmailMock.mockResolvedValue(undefined);
    await handle(completed({ metadata: { tenant_id: 5, order_id: undefined } }));
    expect(rpcCalls).toHaveLength(1);
  });

  it("tolerates a tenant with no payment_accounts row (no account cross-check possible)", async () => {
    scenario.tenantStripeAccountId = null;
    sendOrderConfirmationEmailMock.mockResolvedValue(undefined);
    await handle(completed());
    expect(rpcCalls).toHaveLength(1);
  });
});

describe("markOrderReceived failure modes", () => {
  it("throws on an unexpected RPC error so the route returns 5xx and Stripe retries", async () => {
    scenario.rpcResult = { data: null, error: { message: "connection reset" } };
    await expect(handle(completed())).rejects.toThrow(
      "mark_order_received_and_paid failed for order order-1: connection reset",
    );
    expect(recordOrderAuditEventMock).not.toHaveBeenCalled();
    expect(sendOrderConfirmationEmailMock).not.toHaveBeenCalled();
  });

  it("acknowledges without audit event or email when the RPC declines (order already moved on)", async () => {
    scenario.rpcResult = { data: false, error: null };
    await expect(handle(completed())).resolves.toBeUndefined();
    expect(recordOrderAuditEventMock).not.toHaveBeenCalled();
    expect(sendOrderConfirmationEmailMock).not.toHaveBeenCalled();
  });

  it("swallows a throwing confirmation email after the order was already confirmed", async () => {
    sendOrderConfirmationEmailMock.mockRejectedValue(new Error("smtp down"));
    await expect(handle(completed())).resolves.toBeUndefined();
    expect(auditActions()).toEqual(["payment_confirmed"]);
    expect(recordOrderAuditEventMock.mock.calls[0]![1]).toMatchObject({
      tenantId: "tenant-1",
      targetId: "order-1",
      metadata: { stripeEventId: "evt_1", stripeCheckoutSessionId: "cs_test_abc" },
    });
  });
});

describe("checkout.session.expired", () => {
  it("acknowledges when no payments row matches", async () => {
    scenario.payment = null;
    await expect(handle(expired())).resolves.toBeUndefined();
    expect(eventInserts).toHaveLength(0);
  });

  it("acknowledges when the order is missing or belongs to another tenant", async () => {
    scenario.order = null;
    await handle(expired());
    scenario.order = { id: "order-1", tenant_id: "tenant-2", status: "awaiting_payment" };
    await handle(expired());
    expect(eventInserts).toHaveLength(0);
  });

  it("flags and does not cancel when the connected account on the event differs", async () => {
    await handle(expired({}, { account: "acct_other" }));
    expect(eventInserts).toHaveLength(0);
    expect(auditActions()).toEqual(["payment_webhook_tenant_mismatch_flagged"]);
    expect(paymentUpdates).toEqual([{ status: "flagged_for_review" }]);
  });

  it("flags when the session metadata points at another tenant", async () => {
    await handle(expired({ metadata: { tenant_id: "tenant-2", order_id: "order-1" } }));
    expect(eventInserts).toHaveLength(0);
    expect(auditActions()).toEqual(["payment_webhook_tenant_mismatch_flagged"]);
  });

  it("does not record an audit event or payment update when the cancellation insert fails", async () => {
    scenario.eventInsertError = { message: "check_violation" };
    await expect(handle(expired())).resolves.toBeUndefined();
    expect(eventInserts).toHaveLength(1);
    expect(paymentUpdates).toHaveLength(0);
    expect(recordOrderAuditEventMock).not.toHaveBeenCalled();
  });

  it("is idempotent for an order that is already cancelled", async () => {
    scenario.order!.status = "cancelled";
    await handle(expired());
    expect(eventInserts).toHaveLength(0);
    expect(paymentUpdates).toHaveLength(0);
  });
});

describe("payment_intent.payment_failed -- guards", () => {
  it("acknowledges when the order is missing or in another tenant", async () => {
    scenario.order = null;
    await handle(failed());
    scenario.order = { id: "order-1", tenant_id: "tenant-2", status: "awaiting_payment" };
    await handle(failed());
    expect(eventInserts).toHaveLength(0);
  });

  it("flags a tenant mismatch (connected account on the event differs) and does not cancel", async () => {
    await handle(failed({ account: "acct_other" }));
    expect(eventInserts).toHaveLength(0);
    expect(auditActions()).toEqual(["payment_webhook_tenant_mismatch_flagged"]);
    expect(recordOrderAuditEventMock.mock.calls[0]![1]).toMatchObject({
      metadata: { stripeEventId: "evt_fail", stripePaymentIntentId: "pi_test_abc" },
    });
  });

  it("flags when the tenant's current Stripe account was rotated away from the payment's", async () => {
    scenario.tenantStripeAccountId = "acct_rotated";
    await handle(failed());
    expect(eventInserts).toHaveLength(0);
    expect(paymentUpdates).toEqual([{ status: "flagged_for_review" }]);
  });

  it("ignores a late failure for an order that already succeeded", async () => {
    scenario.order!.status = "received";
    await handle(failed());
    expect(eventInserts).toHaveLength(0);
    expect(paymentUpdates).toHaveLength(0);
  });

  it("logs and leaves the payment untouched when the cancellation insert fails", async () => {
    scenario.eventInsertError = { message: "check_violation" };
    await handle(failed());
    expect(paymentUpdates).toHaveLength(0);
    expect(recordOrderAuditEventMock).not.toHaveBeenCalled();
  });
});

describe("unhandled event types", () => {
  it.each(["charge.refunded", "charge.dispute.created", "payment_intent.succeeded"])(
    "acknowledges %s without touching any table",
    async (type) => {
      await expect(
        handle({ id: "evt_x", type, data: { object: {} } } as unknown as Stripe.Event),
      ).resolves.toBeUndefined();
      expect(rpcCalls).toHaveLength(0);
      expect(eventInserts).toHaveLength(0);
      expect(paymentUpdates).toHaveLength(0);
    },
  );
});

// Issue #204 (audit 2026-11): a transient database failure during a lookup
// must never be mistaken for "row not found". The handler has to throw so
// the route answers 5xx, leaves `processed_at` null, and Stripe retries.
describe("transient database errors are not treated as 'not found' (issue #204)", () => {
  const dbError = { message: "connection terminated unexpectedly" };

  it.each([
    ["checkout.session.completed", () => completed()],
    ["checkout.session.expired", () => expired()],
    ["payment_intent.payment_failed", () => failed()],
  ])("%s: throws when the payments lookup fails", async (_name, makeEvent) => {
    scenario.lookupErrors.payments = dbError;
    await expect(handle(makeEvent())).rejects.toThrow(/payments lookup failed/);
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toHaveLength(0);
    expect(eventInserts).toHaveLength(0);
  });

  it.each([
    ["checkout.session.completed", () => completed()],
    ["checkout.session.expired", () => expired()],
    ["payment_intent.payment_failed", () => failed()],
  ])("%s: throws when the orders lookup fails", async (_name, makeEvent) => {
    scenario.lookupErrors.orders = dbError;
    await expect(handle(makeEvent())).rejects.toThrow(/orders lookup failed/);
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toHaveLength(0);
    expect(eventInserts).toHaveLength(0);
  });

  it("throws when the payment_accounts lookup fails instead of skipping the account cross-check", async () => {
    scenario.lookupErrors.payment_accounts = dbError;
    // The tenant's real current account differs from the payment's: if the
    // failed lookup were read as "no account", this mismatch would go
    // unnoticed and the order would be marked paid.
    scenario.tenantStripeAccountId = "acct_rotated";
    await expect(handle(completed())).rejects.toThrow(/payment_accounts lookup failed/);
    expect(rpcCalls).toHaveLength(0);
    expect(auditActions()).toEqual([]);
  });

  it("throws when flagging a payment for review cannot be written, and records no audit event", async () => {
    scenario.paymentUpdateError = dbError;
    await expect(handle(completed({ amount_total: 1 }))).rejects.toThrow(/failed to flag payment/);
    expect(auditActions()).toEqual([]);
    expect(rpcCalls).toHaveLength(0);
  });

  it("a genuinely missing row (no error) is still acknowledged without throwing", async () => {
    scenario.payment = null;
    await expect(handle(completed())).resolves.toBeUndefined();
    reset();
    scenario.order = null;
    await expect(handle(completed())).resolves.toBeUndefined();
    expect(rpcCalls).toHaveLength(0);
  });

  it("the retried delivery succeeds once the database is reachable again", async () => {
    scenario.lookupErrors.payments = dbError;
    await expect(handle(completed())).rejects.toThrow();
    scenario.lookupErrors = {};
    await expect(handle(completed())).resolves.toBeUndefined();
    expect(rpcCalls.map((call) => call.fn)).toEqual(["mark_order_received_and_paid"]);
  });
});
