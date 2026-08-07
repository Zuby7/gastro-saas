import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CartLineView } from "@/lib/cart/types";
import { CartLine } from "./cart-line";

vi.mock("./actions", () => ({
  updateCartItemQuantityAction: async () => ({}),
  removeCartItemAction: async () => ({}),
}));

const availableLine: CartLineView = {
  cartItemId: "item-1",
  dishId: "dish-1",
  dishName: "Margherita",
  variantId: null,
  variantName: null,
  quantity: 2,
  unitPriceCents: 900,
  selections: [],
  selectionsTotalCents: 0,
  lineTotalCents: 1800,
  isAvailable: true,
};

/**
 * Semantic-structure a11y coverage for the cart's `CartLine` (Epic 6,
 * ticket #20) -- added as part of the epic-6 batch review's finding 2
 * (no automated a11y test coverage for the epic's new customer-facing
 * surfaces), following the same RTL-based semantic checks used elsewhere
 * in this repo (roles, labels, aria-live).
 */
describe("CartLine accessibility", () => {
  it("has a polite, screen-reader-only live region for quantity/removal announcements", () => {
    render(<CartLine line={availableLine} tenantSlug="demo" currency="EUR" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveClass("sr-only");
  });

  it("labels the quantity input for each line item distinctly", () => {
    render(<CartLine line={availableLine} tenantSlug="demo" currency="EUR" />);

    const quantityInput = screen.getByLabelText("Menge für Margherita");
    expect(quantityInput).toHaveAttribute("type", "number");
  });

  it("provides accessible submit buttons for updating and removing the line", () => {
    render(<CartLine line={availableLine} tenantSlug="demo" currency="EUR" />);

    expect(screen.getByRole("button", { name: "Aktualisieren" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entfernen" })).toBeInTheDocument();
  });

  it("surfaces an unavailable dish as visible text, not color alone (no color-only signaling)", () => {
    const unavailableLine: CartLineView = { ...availableLine, isAvailable: false };
    render(<CartLine line={unavailableLine} tenantSlug="demo" currency="EUR" />);

    expect(
      screen.getByText(
        "Dieses Gericht ist zwischenzeitlich nicht mehr verfügbar. Bitte entfernen Sie es, um fortzufahren.",
      ),
    ).toBeInTheDocument();
  });
});
