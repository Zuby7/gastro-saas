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

  it("labels the stepper buttons and the current quantity for each line item distinctly", () => {
    render(<CartLine line={availableLine} tenantSlug="demo" currency="EUR" />);

    expect(screen.getByLabelText("Menge für Margherita: 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menge für Margherita verringern" })).toHaveAttribute(
      "value",
      "1",
    );
    expect(screen.getByRole("button", { name: "Menge für Margherita erhöhen" })).toHaveAttribute(
      "value",
      "3",
    );
  });

  it("disables the minus button at quantity 1 and the plus button at 20 (server still validates)", () => {
    const { rerender } = render(
      <CartLine line={{ ...availableLine, quantity: 1 }} tenantSlug="demo" currency="EUR" />,
    );
    expect(screen.getByRole("button", { name: "Menge für Margherita verringern" })).toBeDisabled();

    rerender(
      <CartLine line={{ ...availableLine, quantity: 20 }} tenantSlug="demo" currency="EUR" />,
    );
    expect(screen.getByRole("button", { name: "Menge für Margherita erhöhen" })).toBeDisabled();
  });

  it("gives the stepper and remove buttons a 44 px tap target and wraps instead of overflowing", () => {
    const { container } = render(
      <CartLine line={availableLine} tenantSlug="demo" currency="EUR" />,
    );

    expect(screen.getByRole("button", { name: "Menge für Margherita erhöhen" })).toHaveClass(
      "h-11",
      "w-11",
    );
    expect(screen.getByRole("button", { name: "Entfernen" })).toHaveClass("min-h-11");
    expect(container.querySelector(".flex-wrap")).not.toBeNull();
    expect(container.innerHTML).not.toContain("w-24");
  });

  it("provides accessible submit buttons for removing the line and no separate update button", () => {
    render(<CartLine line={availableLine} tenantSlug="demo" currency="EUR" />);

    expect(screen.queryByRole("button", { name: "Aktualisieren" })).toBeNull();
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
