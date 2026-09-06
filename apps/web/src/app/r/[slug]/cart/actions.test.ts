import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePathMock = vi.fn();
const afterMock = vi.fn((callback: () => unknown) => {
  // Mirrors next/server's real after(): the callback's promise is handled by
  // the platform's own request lifecycle, not surfaced back to the caller --
  // a rejection inside it must never propagate out of after() itself.
  const result = callback();
  if (result && typeof (result as Promise<unknown>).catch === "function") {
    (result as Promise<unknown>).catch(() => {});
  }
  return result;
});
const resolveGuestCartContextMock = vi.fn();
const addCartItemMock = vi.fn();
const recordAddToCartEventOnceMock = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("next/server", () => ({
  after: (callback: () => unknown) => afterMock(callback),
}));

vi.mock("@/lib/cart/cookie", () => ({
  readCartToken: vi.fn(),
}));

vi.mock("@/lib/cart/token", () => ({
  hashCartToken: vi.fn(),
}));

vi.mock("@/lib/cart/service", () => ({
  addCartItem: (...args: unknown[]) => addCartItemMock(...args),
  getCartView: vi.fn(),
  getOrCreateCartId: vi.fn(),
  removeCartItem: vi.fn(),
  resolveGuestCartContext: (...args: unknown[]) => resolveGuestCartContextMock(...args),
  resolveTenantIdBySlug: vi.fn(),
  updateCartItemQuantity: vi.fn(),
}));

vi.mock("@/lib/menu-view/service", () => ({
  recordAddToCartEventOnce: (...args: unknown[]) => recordAddToCartEventOnceMock(...args),
}));

function addToCartFormData(dishId: string) {
  const fd = new FormData();
  fd.set("dishId", dishId);
  fd.set("dishVariantId", "");
  fd.set("quantity", "1");
  fd.set("optionIds", "");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveGuestCartContextMock.mockResolvedValue({
    tenantId: "11111111-1111-1111-1111-111111111111",
    cartId: "22222222-2222-2222-2222-222222222222",
  });
  addCartItemMock.mockResolvedValue({ itemCount: 1, items: [], totalCents: 1000 });
});

describe("addToCartAction", () => {
  it(
    "registers the add_to_cart analytics write via next/server's after() instead of " +
      "awaiting it inline (PR #136 Opus finding: this used to add its own round trip's " +
      "latency to the user-blocking cart mutation)",
    async () => {
      const dishId = "33333333-3333-4333-a333-333333333333";
      const { addToCartAction } = await import("./actions");

      const result = await addToCartAction("some-tenant", {}, addToCartFormData(dishId));

      expect(result.cart).toEqual({ itemCount: 1, items: [], totalCents: 1000 });
      expect(afterMock).toHaveBeenCalledTimes(1);
      expect(recordAddToCartEventOnceMock).toHaveBeenCalledWith(
        "some-tenant",
        "11111111-1111-1111-1111-111111111111",
        dishId,
      );
    },
  );

  it("still returns the cart successfully even if the deferred analytics write later rejects", async () => {
    // after()'s callback runs post-response and recordAddToCartEventOnce
    // already swallows its own errors internally -- this proves a rejection
    // from it can never surface as a failed cart action.
    recordAddToCartEventOnceMock.mockRejectedValue(new Error("boom"));
    const dishId = "44444444-4444-4444-a444-444444444444";

    const { addToCartAction } = await import("./actions");
    const result = await addToCartAction("some-tenant", {}, addToCartFormData(dishId));

    expect(result.error).toBeUndefined();
    expect(result.cart).toEqual({ itemCount: 1, items: [], totalCents: 1000 });
  });
});
