import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const maybeSingleMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();
const readCartTokenMock = vi.fn();
const writeCartTokenCookieMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: fromMock, rpc: rpcMock }),
}));

vi.mock("./cookie", () => ({
  readCartToken: (...args: unknown[]) => readCartTokenMock(...args),
  writeCartTokenCookie: (...args: unknown[]) => writeCartTokenCookieMock(...args),
}));

import {
  addCartItem,
  getCartView,
  getOrCreateCartId,
  removeCartItem,
  resolveGuestCartContext,
  resolveTenantIdBySlug,
  updateCartItemQuantity,
} from "./service";
import { hashCartToken } from "./token";

const cartView = { id: "cart-1", items: [] };

beforeEach(() => {
  vi.clearAllMocks();
  eqMock.mockReturnValue({ maybeSingle: maybeSingleMock });
  selectMock.mockReturnValue({ eq: eqMock });
  fromMock.mockReturnValue({ select: selectMock });
});

describe("resolveTenantIdBySlug", () => {
  it("looks the tenant up by slug and returns its id", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "tenant-1" } });
    await expect(resolveTenantIdBySlug("demo")).resolves.toBe("tenant-1");
    expect(fromMock).toHaveBeenCalledWith("tenants");
    expect(eqMock).toHaveBeenCalledWith("slug", "demo");
  });

  it("returns null for an unknown slug", async () => {
    maybeSingleMock.mockResolvedValue({ data: null });
    await expect(resolveTenantIdBySlug("nope")).resolves.toBeNull();
  });
});

describe("resolveGuestCartContext", () => {
  it("throws for an unknown restaurant slug before touching the cookie or cart", async () => {
    maybeSingleMock.mockResolvedValue({ data: null });
    await expect(resolveGuestCartContext("nope")).rejects.toThrow("Restaurant nicht gefunden.");
    expect(readCartTokenMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("reuses an existing cookie token and passes only its hash to the RPC", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "tenant-1" } });
    readCartTokenMock.mockResolvedValue("raw-token");
    rpcMock.mockResolvedValue({ data: "cart-1", error: null });

    await expect(resolveGuestCartContext("demo")).resolves.toEqual({
      tenantId: "tenant-1",
      cartId: "cart-1",
    });

    expect(writeCartTokenCookieMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("get_or_create_cart", {
      p_tenant_id: "tenant-1",
      p_cart_token_hash: hashCartToken("raw-token"),
    });
  });

  it("mints and writes a fresh token when no cookie exists", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "tenant-1" } });
    readCartTokenMock.mockResolvedValue(null);
    rpcMock.mockResolvedValue({ data: "cart-2", error: null });

    const result = await resolveGuestCartContext("demo");

    expect(result.cartId).toBe("cart-2");
    expect(writeCartTokenCookieMock).toHaveBeenCalledTimes(1);
    const [slug, token] = writeCartTokenCookieMock.mock.calls[0]!;
    expect(slug).toBe("demo");
    expect(typeof token).toBe("string");
    expect(rpcMock).toHaveBeenCalledWith(
      "get_or_create_cart",
      expect.objectContaining({ p_cart_token_hash: hashCartToken(token as string) }),
    );
  });
});

describe("getOrCreateCartId", () => {
  it("returns the cart id", async () => {
    rpcMock.mockResolvedValue({ data: "cart-1", error: null });
    await expect(getOrCreateCartId("tenant-1", "hash")).resolves.toBe("cart-1");
  });

  it.each([
    ["an rpc error", { data: null, error: { message: "boom" } }],
    ["no data", { data: null, error: null }],
  ])("throws a generic German error on %s", async (_label, response) => {
    rpcMock.mockResolvedValue(response);
    await expect(getOrCreateCartId("tenant-1", "hash")).rejects.toThrow(
      "Der Warenkorb konnte nicht geladen werden.",
    );
  });
});

describe("getCartView", () => {
  it("passes both cart and tenant ids to the RPC and returns the view", async () => {
    rpcMock.mockResolvedValue({ data: cartView, error: null });
    await expect(getCartView("cart-1", "tenant-1")).resolves.toEqual(cartView);
    expect(rpcMock).toHaveBeenCalledWith("get_cart_view", {
      p_cart_id: "cart-1",
      p_tenant_id: "tenant-1",
    });
  });

  it("throws without leaking the raw RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "secret db detail" } });
    await expect(getCartView("cart-1", "tenant-1")).rejects.toThrow(
      "Der Warenkorb konnte nicht geladen werden.",
    );
  });
});

describe("addCartItem", () => {
  const input = {
    cartId: "cart-1",
    tenantId: "tenant-1",
    dishId: "dish-1",
    dishVariantId: null,
    quantity: 2,
    optionIds: ["opt-1"],
  };

  it("maps the input onto the RPC parameters and returns the view", async () => {
    rpcMock.mockResolvedValue({ data: cartView, error: null });
    await expect(addCartItem(input)).resolves.toEqual(cartView);
    expect(rpcMock).toHaveBeenCalledWith("add_cart_item", {
      p_cart_id: "cart-1",
      p_tenant_id: "tenant-1",
      p_dish_id: "dish-1",
      p_dish_variant_id: null,
      p_quantity: 2,
      p_option_ids: ["opt-1"],
    });
  });

  it("maps a 'no longer available' error to a dedicated message (case-insensitive)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "Dish is No Longer Available" } });
    await expect(addCartItem(input)).rejects.toThrow(
      "Dieses Gericht ist leider nicht mehr verfügbar.",
    );
  });

  it("maps any other error to the generic message", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "constraint violation x" } });
    await expect(addCartItem(input)).rejects.toThrow(
      "Der Artikel konnte nicht zum Warenkorb hinzugefügt werden.",
    );
  });
});

describe("updateCartItemQuantity", () => {
  it("passes cart, tenant, item and quantity to the RPC", async () => {
    rpcMock.mockResolvedValue({ data: cartView, error: null });
    await expect(updateCartItemQuantity("cart-1", "tenant-1", "item-1", 3)).resolves.toEqual(
      cartView,
    );
    expect(rpcMock).toHaveBeenCalledWith("update_cart_item_quantity", {
      p_cart_id: "cart-1",
      p_tenant_id: "tenant-1",
      p_cart_item_id: "item-1",
      p_quantity: 3,
    });
  });

  it("throws on error or empty result", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "x" } });
    await expect(updateCartItemQuantity("c", "t", "i", 1)).rejects.toThrow(
      "Die Menge konnte nicht aktualisiert werden.",
    );
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(updateCartItemQuantity("c", "t", "i", 1)).rejects.toThrow(
      "Die Menge konnte nicht aktualisiert werden.",
    );
  });
});

describe("removeCartItem", () => {
  it("passes cart, tenant and item to the RPC", async () => {
    rpcMock.mockResolvedValue({ data: cartView, error: null });
    await expect(removeCartItem("cart-1", "tenant-1", "item-1")).resolves.toEqual(cartView);
    expect(rpcMock).toHaveBeenCalledWith("remove_cart_item", {
      p_cart_id: "cart-1",
      p_tenant_id: "tenant-1",
      p_cart_item_id: "item-1",
    });
  });

  it("throws on error or empty result", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "x" } });
    await expect(removeCartItem("c", "t", "i")).rejects.toThrow(
      "Der Artikel konnte nicht entfernt werden.",
    );
    rpcMock.mockResolvedValue({ data: null, error: null });
    await expect(removeCartItem("c", "t", "i")).rejects.toThrow(
      "Der Artikel konnte nicht entfernt werden.",
    );
  });
});
