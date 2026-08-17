import { describe, expect, it } from "vitest";
import {
  analyzeExtrasPerformance,
  compareTrendPeriods,
  type PeriodStats,
} from "./trend-comparison";

function period(overrides: Partial<PeriodStats> = {}): PeriodStats {
  return {
    start: "2026-08-11T00:00:00Z",
    end: "2026-08-18T00:00:00Z",
    isComplete: true,
    grossRevenueCents: 0,
    netRevenueCents: 0,
    paidOrdersCount: 0,
    ...overrides,
  };
}

describe("compareTrendPeriods (ticket #32)", () => {
  it("never compares an incomplete current period against a complete previous period without a caveat (acceptance criterion 1)", () => {
    const current = period({ isComplete: false, netRevenueCents: 4000, paidOrdersCount: 3 });
    const previous = period({ isComplete: true, netRevenueCents: 10_000, paidOrdersCount: 10 });

    const result = compareTrendPeriods(current, previous);

    expect(result.comparisonCaveat).not.toBeNull();
    expect(result.isComparisonReliable).toBe(false);
    // The raw numbers are still returned -- the caveat accompanies them, it
    // never hides/omits them (ticket #32: "nicht unkommentiert", not "nicht
    // dargestellt").
    expect(result.netRevenueChangePercent).toBeCloseTo(-60);
  });

  it("reports no caveat and a reliable comparison when both periods are complete", () => {
    const current = period({ isComplete: true, netRevenueCents: 12_000, paidOrdersCount: 12 });
    const previous = period({ isComplete: true, netRevenueCents: 10_000, paidOrdersCount: 10 });

    const result = compareTrendPeriods(current, previous);

    expect(result.comparisonCaveat).toBeNull();
    expect(result.isComparisonReliable).toBe(true);
    expect(result.netRevenueChangePercent).toBeCloseTo(20);
    expect(result.paidOrdersChangePercent).toBeCloseTo(20);
  });

  it("flags an incomplete PREVIOUS period too (e.g. a custom range whose prior window hasn't fully elapsed)", () => {
    const current = period({ isComplete: true });
    const previous = period({ isComplete: false });

    const result = compareTrendPeriods(current, previous);

    expect(result.comparisonCaveat).not.toBeNull();
    expect(result.isComparisonReliable).toBe(false);
  });

  it("never fabricates a percentage against a zero baseline (previous period had zero revenue/orders)", () => {
    const current = period({ netRevenueCents: 5000, paidOrdersCount: 3 });
    const previous = period({ netRevenueCents: 0, paidOrdersCount: 0 });

    const result = compareTrendPeriods(current, previous);

    expect(result.netRevenueChangePercent).toBeNull();
    expect(result.paidOrdersChangePercent).toBeNull();
  });
});

describe("analyzeExtrasPerformance (ticket #32 acceptance criterion 2)", () => {
  it("computes selection rate and surfaces additional revenue correctly", () => {
    const results = analyzeExtrasPerformance([
      {
        optionId: "extra-cheese",
        optionName: "Extra Käse",
        priceDeltaCents: 150,
        eligibleOrderItemCount: 40,
        selectionCount: 10,
        additionalRevenueCents: 1500,
      },
    ]);

    expect(results[0]!.selectionRate).toBeCloseTo(0.25);
    expect(results[0]!.additionalRevenueCents).toBe(1500);
  });

  it("returns null selection rate (never a fabricated 0%) when there are no eligible order items", () => {
    const results = analyzeExtrasPerformance([
      {
        optionId: "olives",
        optionName: "Oliven",
        priceDeltaCents: 100,
        eligibleOrderItemCount: 0,
        selectionCount: 0,
        additionalRevenueCents: 0,
      },
    ]);

    expect(results[0]!.selectionRate).toBeNull();
  });
});
