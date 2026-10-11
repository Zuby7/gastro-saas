import { beforeEach, describe, expect, it, vi } from "vitest";
import { MollieNotConnectedError } from "@/lib/mollie/tokens";
import { PaymentAccountNotReadyError } from "./types";

const createMolliePaymentMock = vi.fn();
const getAccessMock = vi.fn();
const auditMock = vi.fn();
const insertMock = vi.fn();

vi.mock("@/lib/mollie/client", () => ({
  createMolliePayment: (...args: unknown[]) => createMolliePaymentMock(...args),
}));
vi.mock("@/lib/mollie/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mollie/tokens")>();
  return { ...actual, getMollieAccessForTenant: (...args: unknown[]) => getAccessMock(...args) };
});
vi.mock("@/lib/audit/record-order-audit-event", () => ({
  recordOrderAuditEvent: (...args: unknown[]) => auditMock(...args),
}));

let order: Record<string, unknown> | null;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: order, error: order ? null : { message: "x" } }),
              }),
            }),
          }),
        };
      }
      if (table === "payments") {
        return { insert: (payload: unknown) => insertMock(payload) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { createMolliePaymentForOrder } from "./mollie-service";

const input = {
  tenantId: "tenant-1",
  tenantSlug: "demo",
  orderId: "11111111-2222-3333-4444-555555555555",
  guestAccessToken: "guest-token",
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
  order = {
    id: input.orderId,
    tenant_id: "tenant-1",
    status: "awaiting_payment",
    total_cents: 1234,
    currency: "EUR",
  };
  createMolliePaymentMock.mockReset().mockResolvedValue({
    id: "tr_abc",
    checkoutUrl: "https://www.mollie.com/checkout/abc",
  });
  getAccessMock.mockReset().mockResolvedValue({ accessToken: "tok", profileId: "pfl_1" });
  insertMock.mockReset().mockResolvedValue({ error: null });
  auditMock.mockReset();
});

describe("createMolliePaymentForOrder", () => {
  it("creates the Mollie payment from the server-side order total and records a pending row", async () => {
    const result = await createMolliePaymentForOrder(input);

    expect(result).toEqual({ checkoutUrl: "https://www.mollie.com/checkout/abc" });
    expect(createMolliePaymentMock).toHaveBeenCalledWith("tok", "pfl_1", {
      amountCents: 1234,
      description: "Bestellung 11111111",
      redirectUrl: "https://app.example/r/demo/orders/guest-token?checkout=success",
      webhookUrl: "https://app.example/api/webhooks/mollie",
      orderId: input.orderId,
      tenantId: "tenant-1",
      idempotencyKey: `mollie-payment:${input.orderId}`,
    });
    expect(insertMock).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      order_id: input.orderId,
      provider: "mollie",
      mollie_payment_id: "tr_abc",
      amount_cents: 1234,
      currency: "EUR",
    });
    expect(auditMock).toHaveBeenCalledOnce();
  });

  it("never writes a paid status", async () => {
    await createMolliePaymentForOrder(input);
    expect(JSON.stringify(insertMock.mock.calls)).not.toContain("paid");
  });

  it("refuses orders that are not awaiting payment", async () => {
    order!.status = "received";
    await expect(createMolliePaymentForOrder(input)).rejects.toThrow("not awaiting payment");
    expect(createMolliePaymentMock).not.toHaveBeenCalled();
  });

  it("refuses non-EUR orders", async () => {
    order!.currency = "USD";
    await expect(createMolliePaymentForOrder(input)).rejects.toThrow("EUR");
    expect(createMolliePaymentMock).not.toHaveBeenCalled();
  });

  it("rejects with PaymentAccountNotReadyError when the tenant is not connected", async () => {
    getAccessMock.mockRejectedValue(new MollieNotConnectedError());
    await expect(createMolliePaymentForOrder(input)).rejects.toBeInstanceOf(
      PaymentAccountNotReadyError,
    );
    expect(createMolliePaymentMock).not.toHaveBeenCalled();
  });

  it("tolerates a unique violation (idempotent retry) but surfaces other insert errors", async () => {
    insertMock.mockResolvedValueOnce({ error: { code: "23505" } });
    await expect(createMolliePaymentForOrder(input)).resolves.toBeDefined();

    insertMock.mockResolvedValueOnce({ error: { code: "23514" } });
    await expect(createMolliePaymentForOrder(input)).rejects.toThrow("Failed to record");
  });
});
