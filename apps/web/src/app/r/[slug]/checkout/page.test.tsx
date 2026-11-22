import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CartView } from "@/lib/cart/types";

const loadCartViewForDisplayMock = vi.fn();

vi.mock("@/lib/cart/display", () => ({
  loadCartViewForDisplay: (...args: unknown[]) => loadCartViewForDisplayMock(...args),
}));

vi.mock("@/lib/public-menu/fetch", () => ({
  getPublicTenantName: async () => "Trattoria Roma",
}));

vi.mock("./checkout-form", () => ({
  CheckoutForm: () => <form aria-label="Bestellformular" />,
}));

const cart: CartView = {
  cartId: "cart-1",
  currency: "EUR",
  totalCents: 2400,
  itemCount: 3,
  hasUnavailableItems: false,
  checkoutReady: true,
  items: [
    {
      cartItemId: "item-1",
      dishId: "dish-1",
      dishName: "Pizza Margherita",
      variantId: "v1",
      variantName: "Groß",
      quantity: 2,
      unitPriceCents: 1000,
      selections: [{ optionId: "o1", name: "Extra Käse", priceDeltaCents: 100, isAvailable: true }],
      selectionsTotalCents: 100,
      lineTotalCents: 2200,
      isAvailable: true,
    },
    {
      cartItemId: "item-2",
      dishId: "dish-2",
      dishName: "Cola",
      variantId: null,
      variantName: null,
      quantity: 1,
      unitPriceCents: 200,
      selections: [],
      selectionsTotalCents: 0,
      lineTotalCents: 200,
      isAvailable: true,
    },
  ],
};

beforeEach(() => {
  loadCartViewForDisplayMock.mockReset();
});

describe("CheckoutPage order summary", () => {
  it("lists every cart item with quantity, name and the server-calculated line price next to the total", async () => {
    loadCartViewForDisplayMock.mockResolvedValue(cart);
    const { default: CheckoutPage } = await import("./page");

    render(await CheckoutPage({ params: Promise.resolve({ slug: "demo" }) }));

    expect(screen.getByText(/2× Pizza Margherita \(Groß\)/)).toBeInTheDocument();
    expect(screen.getByText("Extra Käse")).toBeInTheDocument();
    expect(screen.getByText(/^22,00.?€$/u)).toBeInTheDocument();
    expect(screen.getByText(/1× Cola/)).toBeInTheDocument();
    expect(screen.getByText(/^2,00.?€$/u)).toBeInTheDocument();
    expect(screen.getByText(/^24,00.?€$/u)).toBeInTheDocument();
  });
});
