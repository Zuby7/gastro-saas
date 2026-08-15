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

const soldOutSimpleDish: PublicMenuDish = {
  id: "dish-2",
  name: "Spaghetti Carbonara",
  description: "Ei, Speck, Parmesan",
  priceCents: 1290,
  currency: "EUR",
  soldOut: true,
  image: null,
  variants: [],
  optionGroups: [],
  labels: [],
  allergenNotice: "Enthält Ei, Milch",
};

const soldOutMultiVariantDish: PublicMenuDish = {
  ...multiVariantDish,
  id: "dish-3",
  soldOut: true,
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

/**
 * Fixes for Opus review findings 1 and 2 on PR #80's final repair cycle:
 * (1) sold-out dishes must not have their text content (in particular the
 * legally-motivated allergen notice) dimmed via `opacity`, which failed
 * WCAG AA contrast; (2) sold-out dishes must still show their price -- only
 * the add-to-cart affordance is suppressed.
 */
describe("DishCard sold-out state", () => {
  it("does not apply an opacity class to the allergen-notice element for a sold-out simple dish", () => {
    const { container } = render(<DishCard dish={soldOutSimpleDish} tenantSlug="demo" />);

    const allergenNotice = Array.from(container.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Enthält Ei, Milch"),
    );
    expect(allergenNotice).not.toBeUndefined();
    expect(allergenNotice!.className).not.toMatch(/opacity-/);
    expect(allergenNotice!.closest('[class*="opacity-"]')).toBeNull();
  });

  it("does not apply an opacity class to the description element for a sold-out simple dish", () => {
    const { container } = render(<DishCard dish={soldOutSimpleDish} tenantSlug="demo" />);

    const description = Array.from(container.querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Ei, Speck, Parmesan"),
    );
    expect(description).not.toBeUndefined();
    expect(description!.className).not.toMatch(/opacity-/);
    expect(description!.closest('[class*="opacity-"]')).toBeNull();
  });

  it("still renders the formatted price for a sold-out simple dish, with no add button", () => {
    const { container, getByText, queryByRole } = render(
      <DishCard dish={soldOutSimpleDish} tenantSlug="demo" />,
    );

    expect(getByText("12,90 €")).toBeInTheDocument();
    expect(queryByRole("button")).toBeNull();
    expect(container.querySelector("summary")).toBeNull();
  });

  it("still renders the 'ab {price}' starting price for a sold-out multi-variant dish, with no chooser summary", () => {
    const { queryByRole, container, getByText } = render(
      <DishCard dish={soldOutMultiVariantDish} tenantSlug="demo" />,
    );

    expect(getByText(/ab 8,90.?€/u)).toBeInTheDocument();
    expect(container.querySelector("summary")).toBeNull();
    expect(queryByRole("button")).toBeNull();
  });
});
