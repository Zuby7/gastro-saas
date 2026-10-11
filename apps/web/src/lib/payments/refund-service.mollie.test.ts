import { beforeEach, describe, expect, it, vi } from "vitest";
import { MollieApiError } from "@/lib/mollie/client";
import { MollieNotConnectedError } from "@/lib/mollie/tokens";

const stripeRefundsCreateMock = vi.fn();
const createMollieRefundMock = vi.fn();
const getAccessMock = vi.fn();
const finalizeMock = vi.fn();
const auditMock = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  createStripeClient: () => ({
    refunds: { create: (...args: unknown[]) => stripeRefundsCreateMock(...args) },
  }),
}));
vi.mock("@/lib/mollie/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mollie/client")>();
  return { ...actual, createMollieRefund: (...args: unknown[]) => createMollieRefundMock(...args) };
});
vi.mock("@/lib/mollie/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mollie/tokens")>();
  return { ...actual, getMollieAccessForTenant: (...args: unknown[]) => getAccessMock(...args) };
});
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: (name: string, params: Record<string, unknown>) => finalizeMock(name, params),
  }),
}));
vi.mock("@/lib/audit/record-menu-admin-audit-event", () => ({
  recordMenuAdminAuditEvent: (...args: unknown[]) => auditMock(...args),
}));

import { issueRefundForOrder, PaymentNotRefundableError } from "./refund-service";

let payment: Record<string, unknown> | null;
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
                    limit: () => ({ maybeSingle: async () => ({ data: payment, error: null }) }),
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
            eq: () => ({ eq: () => ({ returns: async () => ({ data: [], error: null }) }) }),
          }),
          insert: (payload: Record<string, unknown>) => {
            insertedRefund = payload;
            return {
              select: () => ({ single: async () => ({ data: { id: "refund-1" }, error: null }) }),
            };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  } as never;
}

const input = {
  tenantId: "tenant-1",
  orderId: "order-1",
  actorUserId: "user-1",
  amountCents: 500,
  reason: "Kunde unzufrieden",
  requestToken: "11111111-2222-4333-8444-555555555555",
};

beforeEach(() => {
  vi.clearAllMocks();
  insertedRefund = undefined;
  payment = {
    id: "payment-1",
    tenant_id: "tenant-1",
    order_id: "order-1",
    stripe_payment_intent_id: null,
    amount_cents: 2000,
    currency: "EUR",
    status: "paid",
    provider: "mollie",
    mollie_payment_id: "tr_abc",
  };
  getAccessMock.mockResolvedValue({ accessToken: "tok", profileId: "pfl_1" });
  createMollieRefundMock.mockResolvedValue({ id: "re_mollie1", status: "queued" });
  finalizeMock.mockResolvedValue({ error: null });
});

describe("issueRefundForOrder with a Mollie (PayPal) payment", () => {
  it("refunds through the Mollie API with the reserved row id as idempotency key and finalizes succeeded", async () => {
    const result = await issueRefundForOrder(fakeSupabase(), input);

    expect(result).toEqual({
      refundId: "refund-1",
      stripeRefundId: "re_mollie1",
      amountCents: 500,
    });
    expect(createMollieRefundMock).toHaveBeenCalledWith("tok", "tr_abc", {
      amountCents: 500,
      description: "Kunde unzufrieden",
      idempotencyKey: "refund:refund-1",
    });
    expect(stripeRefundsCreateMock).not.toHaveBeenCalled();
    expect(insertedRefund).toMatchObject({
      amount_cents: 500,
      status: "pending",
      tenant_id: "tenant-1",
    });
    expect(finalizeMock).toHaveBeenCalledWith("finalize_refund", {
      p_refund_id: "refund-1",
      p_status: "succeeded",
      p_stripe_refund_id: "re_mollie1",
    });
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "payment.refund_succeeded" }),
    );
  });

  it("refuses a Mollie payment row without a Mollie payment id (never falls back to Stripe)", async () => {
    payment!.mollie_payment_id = null;
    await expect(issueRefundForOrder(fakeSupabase(), input)).rejects.toBeInstanceOf(
      PaymentNotRefundableError,
    );
    expect(createMollieRefundMock).not.toHaveBeenCalled();
    expect(stripeRefundsCreateMock).not.toHaveBeenCalled();
  });

  it("fails cleanly before reserving anything when the Mollie connection is gone", async () => {
    getAccessMock.mockRejectedValue(new MollieNotConnectedError());
    await expect(issueRefundForOrder(fakeSupabase(), input)).rejects.toThrow(/Mollie-Verbindung/);
    expect(insertedRefund).toBeUndefined();
    expect(createMollieRefundMock).not.toHaveBeenCalled();
  });

  it("marks a definitive Mollie 4xx rejection failed (releases the reservation)", async () => {
    createMollieRefundMock.mockRejectedValue(new MollieApiError("rejected", 422));
    await expect(issueRefundForOrder(fakeSupabase(), input)).rejects.toThrow(
      "Die Rückerstattung konnte bei Mollie nicht durchgeführt werden.",
    );
    expect(finalizeMock).toHaveBeenCalledWith("finalize_refund", {
      p_refund_id: "refund-1",
      p_status: "failed",
      p_stripe_refund_id: null,
    });
  });

  it("marks an ambiguous failure (network / 5xx) unconfirmed so a retry cannot double-refund", async () => {
    createMollieRefundMock.mockRejectedValue(new MollieApiError("down", 0));
    await expect(issueRefundForOrder(fakeSupabase(), input)).rejects.toThrow(
      /Mollie konnte nicht bestätigt werden/,
    );
    expect(finalizeMock).toHaveBeenCalledWith("finalize_refund", {
      p_refund_id: "refund-1",
      p_status: "unconfirmed",
      p_stripe_refund_id: null,
    });
  });

  it("treats a synchronously failed Mollie refund as failed", async () => {
    createMollieRefundMock.mockResolvedValue({ id: "re_x", status: "failed" });
    await expect(issueRefundForOrder(fakeSupabase(), input)).rejects.toThrow();
    expect(finalizeMock).toHaveBeenCalledWith(
      "finalize_refund",
      expect.objectContaining({ p_status: "failed" }),
    );
  });

  it("does not touch Mollie for a Stripe payment", async () => {
    payment = {
      ...payment,
      provider: "stripe",
      mollie_payment_id: null,
      stripe_payment_intent_id: "pi_1",
    };
    stripeRefundsCreateMock.mockResolvedValue({ id: "re_stripe" });
    await issueRefundForOrder(fakeSupabase(), input);
    expect(stripeRefundsCreateMock).toHaveBeenCalledOnce();
    expect(createMollieRefundMock).not.toHaveBeenCalled();
    expect(getAccessMock).not.toHaveBeenCalled();
  });
});
