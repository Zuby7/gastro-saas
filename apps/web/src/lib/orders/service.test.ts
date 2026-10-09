import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));

import { CheckoutDomainError, createOrderFromCart, getOrderStatusByToken } from "./service";

const input = {
  cartId: "cart-1",
  tenantId: "tenant-1",
  fulfillmentType: "dine_in",
  customerName: "Max",
  customerPhone: "123",
  tableIdentifier: "T5",
  customerNote: "no onions",
  guestAccessTokenHash: "hash",
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createOrderFromCart", () => {
  it("maps the input onto the RPC parameters (no client total) and returns the result", async () => {
    const result = { orderId: "order-1", totalCents: 1000 };
    rpcMock.mockResolvedValue({ data: result, error: null });

    await expect(createOrderFromCart(input)).resolves.toEqual(result);

    expect(rpcMock).toHaveBeenCalledWith("create_order_from_cart", {
      p_cart_id: "cart-1",
      p_tenant_id: "tenant-1",
      p_fulfillment_type: "dine_in",
      p_customer_name: "Max",
      p_customer_phone: "123",
      p_table_identifier: "T5",
      p_customer_note: "no onions",
      p_guest_access_token_hash: "hash",
    });
    const params = rpcMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(params).some((key) => key.includes("total"))).toBe(false);
  });

  it.each([
    [
      "Cart not found for tenant",
      "Ihr Warenkorb wurde nicht gefunden. Bitte laden Sie die Seite neu.",
    ],
    ["Cart is empty", "Ihr Warenkorb ist leer."],
    [
      "Cart is not ready for checkout",
      "Ihr Warenkorb enthält nicht mehr verfügbare Artikel. Bitte prüfen Sie Ihren Warenkorb.",
    ],
    ["Fulfillment type not yet supported", "Diese Bestellart wird aktuell nicht unterstützt."],
    ["Table identifier is required", "Bitte geben Sie eine Tischnummer an."],
    ["Customer name is required", "Bitte geben Sie Ihren Namen an."],
  ])("translates RPC error %j into a safe CheckoutDomainError", async (rpcMessage, expected) => {
    rpcMock.mockResolvedValue({ data: null, error: { message: rpcMessage } });

    const error = await createOrderFromCart(input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CheckoutDomainError);
    expect((error as Error).name).toBe("CheckoutDomainError");
    expect((error as Error).message).toBe(expected);
  });

  it("throws a plain (non-domain) Error for unknown RPC errors so raw text is never shown to guests", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "deadlock detected" } });

    const error = await createOrderFromCart(input).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(CheckoutDomainError);
    expect((error as Error).message).toBe("create_order_from_cart failed: deadlock detected");
  });

  it("throws a plain Error when the RPC returns neither data nor an error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const error = await createOrderFromCart(input).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(CheckoutDomainError);
    expect((error as Error).message).toBe("create_order_from_cart failed: no data returned");
  });
});

describe("getOrderStatusByToken", () => {
  it("looks up by token hash only (never a tenant/order id) and returns the view", async () => {
    const view = { status: "received", tenantSlug: "demo" };
    rpcMock.mockResolvedValue({ data: view, error: null });

    await expect(getOrderStatusByToken("hash")).resolves.toEqual(view);
    expect(rpcMock).toHaveBeenCalledWith("get_order_status_by_token", {
      p_guest_access_token_hash: "hash",
    });
  });

  it("returns null for a miss and for an error, indistinguishably", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(getOrderStatusByToken("hash")).resolves.toBeNull();

    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(getOrderStatusByToken("hash")).resolves.toBeNull();
  });
});
