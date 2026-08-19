// Trend comparison + extras selection-rate logic (Epic 9, ticket #32).
//
// Period boundaries/completeness and raw revenue/order stats are computed by
// `get_trend_period_stats()`/`get_extras_performance_stats()`
// (supabase/migrations/20260818110000_trend_and_extras_analytics.sql, using
// Postgres's own IANA-tz-database-backed `date_trunc(... at time zone tz)`
// for DST-correct period boundaries). This module is the pure, unit-tested
// decision logic on top of that raw data -- mirroring this repo's
// established "pure domain logic + DB aggregation query" split
// (packages/domain/src/cart/pricing.ts + build_cart_view();
// packages/domain/src/analytics/dish-performance.ts + get_dish_performance_stats()).
//
// Explicit non-goal (ticket #32): no AI-driven free-text analysis of order
// notes.

export interface PeriodStats {
  start: string;
  end: string;
  /** True once `p_as_of` (the instant the comparison was requested for) is at or past this period's own end. */
  isComplete: boolean;
  grossRevenueCents: number;
  netRevenueCents: number;
  paidOrdersCount: number;
}

export interface TrendComparisonResult {
  current: PeriodStats;
  previous: PeriodStats;
  /** null when the previous period's net revenue is 0 -- no honest percentage against a zero baseline (never a fabricated +Infinity/NaN). */
  netRevenueChangePercent: number | null;
  /** null when the previous period had zero paid orders, for the same reason. */
  paidOrdersChangePercent: number | null;
  /** False whenever either period hasn't fully elapsed -- see comparisonCaveat. */
  isComparisonReliable: boolean;
  /**
   * Non-null whenever the current OR previous period is incomplete -- ticket
   * #32 acceptance criterion 1: "Ein unvollständiger aktueller Zeitraum wird
   * nicht unkommentiert mit einem vollständigen Vorzeitraum verglichen." The
   * raw numbers/percentages above are still returned (never hidden) -- this
   * caveat is what the UI must render ALONGSIDE them, not instead of them.
   */
  comparisonCaveat: string | null;
}

function percentChange(baseline: number, value: number): number | null {
  if (baseline === 0) {
    return null;
  }
  return ((value - baseline) / Math.abs(baseline)) * 100;
}

/** Decides how a period-vs-prior-period comparison may honestly be presented. Pure function, no I/O. */
export function compareTrendPeriods(
  current: PeriodStats,
  previous: PeriodStats,
): TrendComparisonResult {
  let comparisonCaveat: string | null = null;
  if (!current.isComplete) {
    comparisonCaveat =
      "Der aktuelle Zeitraum ist noch nicht abgeschlossen -- der Vergleich mit dem vollständigen Vorzeitraum ist nur eingeschränkt aussagekräftig.";
  } else if (!previous.isComplete) {
    comparisonCaveat =
      "Der Vorzeitraum ist nicht vollständig erfasst -- der Vergleich ist nur eingeschränkt aussagekräftig.";
  }

  return {
    current,
    previous,
    netRevenueChangePercent: percentChange(previous.netRevenueCents, current.netRevenueCents),
    paidOrdersChangePercent: percentChange(previous.paidOrdersCount, current.paidOrdersCount),
    isComparisonReliable: comparisonCaveat === null,
    comparisonCaveat,
  };
}

/** Raw per-option (extra) aggregates, as returned by `get_extras_performance_stats()`. */
export interface ExtraPerformanceInput {
  optionId: string;
  optionName: string;
  priceDeltaCents: number;
  eligibleOrderItemCount: number;
  selectionCount: number;
  additionalRevenueCents: number;
}

export interface ExtraPerformanceResult extends ExtraPerformanceInput {
  /** selectionCount / eligibleOrderItemCount, or null when eligibleOrderItemCount is 0 (no fabricated 0%/divide-by-zero). */
  selectionRate: number | null;
}

/** Computes each extra's selection rate from its raw counts. Pure function, no I/O. */
export function analyzeExtrasPerformance(
  extras: readonly ExtraPerformanceInput[],
): ExtraPerformanceResult[] {
  return extras.map((extra) => ({
    ...extra,
    selectionRate:
      extra.eligibleOrderItemCount > 0 ? extra.selectionCount / extra.eligibleOrderItemCount : null,
  }));
}
