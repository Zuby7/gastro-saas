import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PublicMenuDish } from "@/lib/public-menu/types";
import { ADD_BUTTON_INTERACTIVE_CLASSNAME } from "./dish-add-button";
import { DishCard } from "./dish-card";

vi.mock("./cart/actions", () => ({
  addToCartAction: async () => ({}),
}));

const multiVariantDish: PublicMenuDish = {
  id: "dish-1",
  name: "Pizza Margherita",
  description: "Tomate, Mozzarella, Basilikum",
  priceCents: null,
  currency: "EUR",
  soldOut: false,
  image: null,
  variants: [
    { id: "variant-small", name: "Klein", priceCents: 890, currency: "EUR" },
    { id: "variant-large", name: "Groß", priceCents: 1290, currency: "EUR" },
  ],
  optionGroups: [],
  labels: [],
  allergenNotice: "",
};

/**
 * Fix for Opus review finding 2 on PR #80: the multi-variant dish card's
 * `<summary>` disclosure trigger must announce the starting price (not just
 * "Auswahl öffnen"), and the focus-visible treatment must live on the
 * actually-focusable element (the `<summary>`), not the decorative
 * `aria-hidden` "+" span.
 */
describe("DishCard multi-variant disclosure trigger accessibility", () => {
  it("includes the lowest variant price in the accessible name", () => {
    const { container } = render(<DishCard dish={multiVariantDish} tenantSlug="demo" />);

    const trigger = container.querySelector("summary");
    expect(trigger).not.toBeNull();
    const label = trigger!.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/^Pizza Margherita, ab 8,90.?€: Auswahl öffnen$/u);
  });

  it("applies the focus-visible treatment to the summary (the real focusable element), not the decorative icon span", () => {
    const { container } = render(<DishCard dish={multiVariantDish} tenantSlug="demo" />);

    const trigger = container.querySelector("summary");
    expect(trigger).not.toBeNull();
    for (const cls of ADD_BUTTON_INTERACTIVE_CLASSNAME.split(" ")) {
      expect(trigger).toHaveClass(cls);
    }

    const decorativeIcon = trigger!.querySelector('[aria-hidden="true"]');
    expect(decorativeIcon).not.toBeNull();
    expect(decorativeIcon).not.toHaveClass("focus-visible:outline");
  });
});
