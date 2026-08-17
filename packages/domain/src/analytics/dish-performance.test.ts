import { describe, expect, it } from "vitest";
import { classifyDishPerformance, type DishPerformanceInput } from "./dish-performance";

function dish(overrides: Partial<DishPerformanceInput> & { dishId: string }): DishPerformanceInput {
  return {
    dishName: overrides.dishId,
    unitsSold: 0,
    revenueCents: 0,
    viewsCount: 0,
    addToCartCount: 0,
    ...overrides,
  };
}

describe("classifyDishPerformance (ticket #31)", () => {
  it("never labels a new/rarely-viewed dish 'low_performer' without sufficient data (acceptance criterion 1)", () => {
    // A brand-new dish with almost no evidence and objectively the worst
    // sales in the set -- would be the clear "worst" by raw ranking, but
    // must not be flagged low_performer because it hasn't accumulated
    // minSampleSize evidence yet.
    const newDish = dish({ dishId: "new", unitsSold: 0, viewsCount: 2, addToCartCount: 1 });
    const establishedDishes = Array.from({ length: 9 }, (_, i) =>
      dish({
        dishId: `established-${i}`,
        unitsSold: 20 + i,
        revenueCents: (20 + i) * 1000,
        viewsCount: 50,
        addToCartCount: 30,
      }),
    );

    const results = classifyDishPerformance([newDish, ...establishedDishes], {
      minSampleSize: 10,
    });

    const newDishResult = results.find((r) => r.dishId === "new")!;
    expect(newDishResult.evidenceCount).toBe(3);
    expect(newDishResult.label).toBe("insufficient_data");
    expect(newDishResult.label).not.toBe("low_performer");
  });

  it("labels a dish with sufficient evidence and genuinely poor sales 'low_performer', carrying its evidence numbers", () => {
    const dishes = [
      dish({
        dishId: "great",
        unitsSold: 100,
        revenueCents: 100_000,
        viewsCount: 200,
        addToCartCount: 150,
      }),
      dish({
        dishId: "ok-1",
        unitsSold: 40,
        revenueCents: 40_000,
        viewsCount: 80,
        addToCartCount: 50,
      }),
      dish({
        dishId: "ok-2",
        unitsSold: 35,
        revenueCents: 35_000,
        viewsCount: 80,
        addToCartCount: 50,
      }),
      dish({
        dishId: "ok-3",
        unitsSold: 30,
        revenueCents: 30_000,
        viewsCount: 80,
        addToCartCount: 50,
      }),
      dish({
        dishId: "poor",
        unitsSold: 2,
        revenueCents: 2_000,
        viewsCount: 100,
        addToCartCount: 20,
      }),
    ];

    const results = classifyDishPerformance(dishes, { minSampleSize: 10 });
    const poor = results.find((r) => r.dishId === "poor")!;

    expect(poor.label).toBe("low_performer");
    // Every low-performer labeling carries its own evidence basis (ticket
    // #31 acceptance criterion 2: Views/Add-to-Cart/Käufe/Conversion).
    expect(poor.viewsCount).toBe(100);
    expect(poor.addToCartCount).toBe(20);
    expect(poor.unitsSold).toBe(2);
    expect(poor.conversionRate).toBeCloseTo(2 / 100);
  });

  it("distinguishes quantity ranking from revenue ranking correctly (a high-volume/low-price dish and a low-volume/high-price dish rank oppositely)", () => {
    const highVolumeLowPrice = dish({
      dishId: "fries",
      unitsSold: 200,
      revenueCents: 200 * 300, // 3.00 EUR each -> 600.00 EUR total
      viewsCount: 500,
      addToCartCount: 300,
    });
    const lowVolumeHighPrice = dish({
      dishId: "steak",
      unitsSold: 20,
      revenueCents: 20 * 4500, // 45.00 EUR each -> 900.00 EUR total
      viewsCount: 100,
      addToCartCount: 40,
    });

    const results = classifyDishPerformance([highVolumeLowPrice, lowVolumeHighPrice], {
      minSampleSize: 10,
    });

    const fries = results.find((r) => r.dishId === "fries")!;
    const steak = results.find((r) => r.dishId === "steak")!;

    // Fries sell more units -> better (lower) quantity rank.
    expect(fries.quantityRank).toBeLessThan(steak.quantityRank);
    // Steak earns more total revenue -> better (lower) revenue rank.
    expect(steak.revenueRank).toBeLessThan(fries.revenueRank);
  });

  it("labels the best-selling dish(es) by quantity 'topseller', never a dish with zero sales", () => {
    const dishes = [
      dish({
        dishId: "bestseller",
        unitsSold: 500,
        revenueCents: 500_000,
        viewsCount: 1000,
        addToCartCount: 700,
      }),
      ...Array.from({ length: 4 }, (_, i) =>
        dish({
          dishId: `mid-${i}`,
          unitsSold: 50,
          revenueCents: 50_000,
          viewsCount: 100,
          addToCartCount: 60,
        }),
      ),
      dish({ dishId: "unsold", unitsSold: 0, revenueCents: 0, viewsCount: 0, addToCartCount: 0 }),
    ];

    const results = classifyDishPerformance(dishes, { minSampleSize: 10, topsellerShare: 0.2 });

    expect(results.find((r) => r.dishId === "bestseller")!.label).toBe("topseller");
    expect(results.find((r) => r.dishId === "unsold")!.label).not.toBe("topseller");
  });

  it("returns an empty array for an empty input (honest empty state, no fabricated ranking)", () => {
    expect(classifyDishPerformance([], { minSampleSize: 10 })).toEqual([]);
  });

  it("rejects a negative minSampleSize", () => {
    expect(() => classifyDishPerformance([dish({ dishId: "a" })], { minSampleSize: -1 })).toThrow(
      /minSampleSize/,
    );
  });

  it("computes conversionRate as null (not a fabricated 0) when there are no views to divide by", () => {
    const results = classifyDishPerformance(
      [dish({ dishId: "a", unitsSold: 5, viewsCount: 0, addToCartCount: 5 })],
      { minSampleSize: 1 },
    );
    expect(results[0]!.conversionRate).toBeNull();
  });
});
