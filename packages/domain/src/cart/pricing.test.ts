import { describe, expect, it } from "vitest";
import { calculateCartPricing } from "./pricing";

describe("calculateCartPricing", () => {
  it("sums unit price, selection deltas, and quantity per line and across the cart", () => {
    const result = calculateCartPricing({
      currency: "EUR",
      lines: [
        {
          cartItemId: "line-1",
          quantity: 2,
          unitPriceCents: 1200,
          isAvailable: true,
          selections: [
            { optionId: "opt-1", priceDeltaCents: 150, isAvailable: true },
            { optionId: "opt-2", priceDeltaCents: 0, isAvailable: true },
          ],
        },
        {
          cartItemId: "line-2",
          quantity: 1,
          unitPriceCents: 890,
          isAvailable: true,
          selections: [],
        },
      ],
    });

    expect(result.lines[0]).toMatchObject({
      selectionsTotalCents: 150,
      lineTotalCents: (1200 + 150) * 2,
      isAvailable: true,
    });
    expect(result.lines[1]).toMatchObject({ lineTotalCents: 890, isAvailable: true });
    expect(result.totalCents).toBe((1200 + 150) * 2 + 890);
    expect(result.itemCount).toBe(2);
    expect(result.hasUnavailableItems).toBe(false);
    expect(result.checkoutReady).toBe(true);
  });

  it("never trusts a precomputed total -- always derives it from current unit prices", () => {
    // Simulates the menu price having changed since the item was added to
    // the cart: only the *current* unitPriceCents (as if freshly read from
    // dishes/dish_variants) may influence the result.
    const staleClientTotal = 1;
    const result = calculateCartPricing({
      currency: "EUR",
      lines: [
        {
          cartItemId: "line-1",
          quantity: 3,
          unitPriceCents: 500,
          isAvailable: true,
          selections: [],
        },
      ],
    });

    expect(result.totalCents).toBe(1500);
    expect(result.totalCents).not.toBe(staleClientTotal);
  });

  it("excludes a line whose dish/variant is no longer available from the total and flags it", () => {
    const result = calculateCartPricing({
      currency: "EUR",
      lines: [
        {
          cartItemId: "available-line",
          quantity: 1,
          unitPriceCents: 1000,
          isAvailable: true,
          selections: [],
        },
        {
          cartItemId: "sold-out-line",
          quantity: 2,
          unitPriceCents: 700,
          isAvailable: false,
          selections: [],
        },
      ],
    });

    expect(result.totalCents).toBe(1000);
    expect(result.lines.find((l) => l.cartItemId === "sold-out-line")).toMatchObject({
      isAvailable: false,
      lineTotalCents: 0,
    });
    expect(result.hasUnavailableItems).toBe(true);
    expect(result.checkoutReady).toBe(false);
  });

  it("treats a line with an unavailable selection (e.g. removed option) as unavailable overall", () => {
    const result = calculateCartPricing({
      currency: "EUR",
      lines: [
        {
          cartItemId: "line-1",
          quantity: 1,
          unitPriceCents: 1000,
          isAvailable: true,
          selections: [{ optionId: "opt-1", priceDeltaCents: 200, isAvailable: false }],
        },
      ],
    });

    expect(result.lines[0]?.isAvailable).toBe(false);
    expect(result.lines[0]?.lineTotalCents).toBe(0);
    expect(result.totalCents).toBe(0);
    expect(result.checkoutReady).toBe(false);
  });

  it("reports checkoutReady = false for an empty cart", () => {
    const result = calculateCartPricing({ currency: "EUR", lines: [] });

    expect(result.itemCount).toBe(0);
    expect(result.totalCents).toBe(0);
    expect(result.checkoutReady).toBe(false);
    expect(result.hasUnavailableItems).toBe(false);
  });

  it("keeps totals as integer minor units (cents), never floating point", () => {
    const result = calculateCartPricing({
      currency: "EUR",
      lines: [
        {
          cartItemId: "line-1",
          quantity: 3,
          unitPriceCents: 333,
          isAvailable: true,
          selections: [{ optionId: "opt-1", priceDeltaCents: 1, isAvailable: true }],
        },
      ],
    });

    expect(Number.isInteger(result.totalCents)).toBe(true);
    expect(result.totalCents).toBe((333 + 1) * 3);
  });
});
