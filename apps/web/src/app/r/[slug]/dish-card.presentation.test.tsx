import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PublicMenuDish } from "@/lib/public-menu/types";
import { DishCard } from "./dish-card";

vi.mock("./cart/actions", () => ({
  addToCartAction: async () => ({}),
}));

const baseDish: PublicMenuDish = {
  id: "dish-1",
  name: "Pizza Margherita",
  description: "Tomate, Mozzarella",
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

describe("DishCard price and allergen presentation", () => {
  it("shows 'ab 8,90 €' for a multi-variant dish", () => {
    const { getAllByText } = render(<DishCard dish={baseDish} tenantSlug="demo" />);
    expect(getAllByText(/^ab 8,90.?€$/u).length).toBeGreaterThan(0);
  });

  it("shows 'Ausverkauft' instead of 'Preis nach Auswahl' for a sold-out dish without a price", () => {
    const dish: PublicMenuDish = { ...baseDish, soldOut: true, priceCents: null, variants: [] };
    const { container, queryByText } = render(<DishCard dish={dish} tenantSlug="demo" />);
    expect(queryByText("Preis nach Auswahl")).toBeNull();
    expect(container.textContent).toContain("Ausverkauft");
  });

  it("rewrites the bare SQL phrase into a clear allergen line", () => {
    const dish: PublicMenuDish = {
      ...baseDish,
      priceCents: 500,
      variants: [],
      allergenNotice: "Vom Restaurant angegeben.",
    };
    const { getByText, queryByText } = render(<DishCard dish={dish} tenantSlug="demo" />);
    expect(getByText("Allergene: vom Restaurant angegeben")).toBeInTheDocument();
    expect(queryByText("Vom Restaurant angegeben.")).toBeNull();
  });

  it("gives the multi-variant disclosure summary a 44 px minimum height", () => {
    const { container } = render(<DishCard dish={baseDish} tenantSlug="demo" />);
    expect(container.querySelector("summary")).toHaveClass("min-h-11");
  });
});
