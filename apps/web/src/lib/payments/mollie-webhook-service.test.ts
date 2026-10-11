import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MollieNotConnectedError } from "@/lib/mollie/tokens";
import type { MolliePayment } from "@/lib/mollie/client";

const getMolliePaymentMock = vi.fn();
const getAccessMock = vi.fn();
const auditMock = vi.fn();
const emailMock = vi.fn();

vi.mock("@/lib/mollie/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mollie/client")>();
  return { ...actual, getMolliePayment: (...args: unknown[]) => getMolliePaymentMock(...args) };
});
vi.mock("@/lib/mollie/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mollie/tokens")>();
  return { ...actual, getMollieAccessForTenant: (...args: unknown[]) => getAccessMock(...args) };
});
vi.mock("@/lib/audit/record-order-audit-event", () => ({
  recordOrderAuditEvent: (...args: unknown[]) => auditMock(...args),
}));
vi.mock("@/lib/notifications/order-confirmation-email", () => ({
  sendOrderConfirmationEmail: (...args: unknown[]) => emailMock(...args),
}));

import { handleMolliePaymentWebhook } from "./mollie-webhook-service";

interface State {
  payment: Record<string, unknown> | null;
  order: Record<string, unknown> | null;
  rpcResult: boolean;
}

let state: State;
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const paymentUpdates: Array<Record<string, unknown>> = [];
const statusEvents: Array<Record<string, unknown>> = [];

function fakeAdmin(): SupabaseClient {
  return {
    from: (table: string) => {
      if (table === "payments") {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.payment }) }) }),
          }),
          update: (values: Record<string, unknown>) => {
            paymentUpdates.push(values);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === "orders") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.order }) }) }),
        };
      }
      if (table === "order_status_events") {
        return {
          insert: async (values: Record<string, unknown>) => {
            statusEvents.push(values);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: state.rpcResult, error: null };
    },
  } as unknown as SupabaseClient;
}

function molliePayment(overrides: Partial<MolliePayment> = {}): MolliePayment {
  return {
    id: "tr_abc123",
    status: "paid",
    amountCents: 1234,
    currency: "EUR",
    method: "paypal",
    mode: "test",
    profileId: "pfl_1",
    metadata: { orderId: "order-1", tenantId: "tenant-1" },
    checkoutUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  state = {
    payment: {
      id: "pay-1",
      tenant_id: "tenant-1",
      order_id: "order-1",
      amount_cents: 1234,
      currency: "EUR",
      status: "pending",
      provider: "mollie",
    },
    order: {
      id: "order-1",
      tenant_id: "tenant-1",
      status: "awaiting_payment",
      total_cents: 1234,
      currency: "EUR",
    },
    rpcResult: true,
  };
  rpcCalls.length = 0;
  paymentUpdates.length = 0;
  statusEvents.length = 0;
  getMolliePaymentMock.mockReset().mockResolvedValue(molliePayment());
  getAccessMock.mockReset().mockResolvedValue({ accessToken: "tok", profileId: "pfl_1" });
  auditMock.mockReset();
  emailMock.mockReset();
  vi.unstubAllEnvs();
});

const flaggedActions = () =>
  auditMock.mock.calls.map((call) => (call[1] as { action: string }).action);

describe("handleMolliePaymentWebhook", () => {
  it("marks the order received and the payment paid exactly once via the atomic RPC", async () => {
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");

    expect(rpcCalls).toEqual([
      {
        fn: "mark_order_received_and_paid",
        args: {
          p_tenant_id: "tenant-1",
          p_order_id: "order-1",
          p_payment_id: "pay-1",
          p_stripe_payment_intent_id: null,
        },
      },
    ]);
    expect(getAccessMock).toHaveBeenCalledWith(expect.anything(), "tenant-1");
    expect(getMolliePaymentMock).toHaveBeenCalledWith("tok", "tr_abc123");
    expect(flaggedActions()).toContain("payment_confirmed");
  });

  it("is idempotent: a replay for an already paid payment changes nothing and never calls Mollie", async () => {
    state.payment!.status = "paid";
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(0);
    expect(getMolliePaymentMock).not.toHaveBeenCalled();
  });

  it("is idempotent when the order already moved on (race): no second paid transition", async () => {
    state.order!.status = "received";
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toHaveLength(0);
  });

  it("acknowledges unknown payment ids silently without calling Mollie", async () => {
    state.payment = null;
    await expect(handleMolliePaymentWebhook(fakeAdmin(), "tr_unknown")).resolves.toBeUndefined();
    expect(getAccessMock).not.toHaveBeenCalled();
    expect(getMolliePaymentMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
  });

  it.each([
    ["amount", { amountCents: 1 }],
    ["currency", { currency: "USD" }],
  ])("flags (never pays) on %s mismatch", async (_name, override) => {
    getMolliePaymentMock.mockResolvedValue(molliePayment(override));
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toEqual([{ status: "flagged_for_review" }]);
    expect(flaggedActions()).toContain("payment_amount_mismatch_flagged");
  });

  it("flags (never pays) when metadata.orderId does not match our row", async () => {
    getMolliePaymentMock.mockResolvedValue(
      molliePayment({ metadata: { orderId: "other-order", tenantId: "tenant-1" } }),
    );
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(0);
    expect(flaggedActions()).toContain("payment_webhook_tenant_mismatch_flagged");
  });

  it("flags (never pays) when the payment belongs to another tenant (metadata or profile)", async () => {
    getMolliePaymentMock.mockResolvedValue(
      molliePayment({ metadata: { orderId: "order-1", tenantId: "tenant-2" } }),
    );
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(0);

    auditMock.mockReset();
    paymentUpdates.length = 0;
    getMolliePaymentMock.mockResolvedValue(molliePayment({ profileId: "pfl_other" }));
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(0);
    expect(flaggedActions()).toContain("payment_webhook_tenant_mismatch_flagged");
  });

  it("flags a mollie payment id mismatch in the fetched payment", async () => {
    getMolliePaymentMock.mockResolvedValue(molliePayment({ id: "tr_different" }));
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(0);
  });

  it("flags a live payment while live mode is not allowed, and a non-PayPal method", async () => {
    getMolliePaymentMock.mockResolvedValue(molliePayment({ mode: "live" }));
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toEqual([{ status: "flagged_for_review" }]);

    paymentUpdates.length = 0;
    getMolliePaymentMock.mockResolvedValue(molliePayment({ method: "creditcard" }));
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toEqual([{ status: "flagged_for_review" }]);
  });

  it("accepts a live payment only when MOLLIE_LIVE_ALLOWED=1", async () => {
    vi.stubEnv("MOLLIE_LIVE_ALLOWED", "1");
    getMolliePaymentMock.mockResolvedValue(molliePayment({ mode: "live" }));
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(1);
  });

  it.each(["open", "pending", "authorized"])("does nothing for status %s", async (status) => {
    getMolliePaymentMock.mockResolvedValue(molliePayment({ status }));
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toHaveLength(0);
    expect(statusEvents).toHaveLength(0);
  });

  it.each([
    ["failed", "failed"],
    ["canceled", "failed"],
    ["expired", "cancelled"],
  ])(
    "cancels the awaiting order on Mollie status %s (payment -> %s)",
    async (status, paymentStatus) => {
      getMolliePaymentMock.mockResolvedValue(molliePayment({ status }));
      await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
      expect(statusEvents).toEqual([
        expect.objectContaining({ from_status: "awaiting_payment", to_status: "cancelled" }),
      ]);
      expect(paymentUpdates).toEqual([{ status: paymentStatus }]);
      expect(rpcCalls).toHaveLength(0);
    },
  );

  it("flags a paid payment that arrives after the order was cancelled", async () => {
    state.order!.status = "cancelled";
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(rpcCalls).toHaveLength(0);
    expect(flaggedActions()).toContain("payment_after_order_cancelled_flagged");
  });

  it("flags instead of guessing when the restaurant is no longer connected", async () => {
    getAccessMock.mockRejectedValue(new MollieNotConnectedError());
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(getMolliePaymentMock).not.toHaveBeenCalled();
    expect(rpcCalls).toHaveLength(0);
    expect(paymentUpdates).toEqual([{ status: "flagged_for_review" }]);
  });

  it("propagates unexpected Mollie/DB failures so the route can answer 5xx", async () => {
    getMolliePaymentMock.mockRejectedValue(new Error("mollie down"));
    await expect(handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123")).rejects.toThrow(
      "mollie down",
    );
  });

  it("does not confirm when the RPC declines (order status moved on)", async () => {
    state.rpcResult = false;
    await handleMolliePaymentWebhook(fakeAdmin(), "tr_abc123");
    expect(flaggedActions()).not.toContain("payment_confirmed");
  });
});
