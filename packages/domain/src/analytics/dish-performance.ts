// Topseller / Low-Performer analysis (Epic 9, ticket #31).
//
// This is the canonical, pure representation of the ranking + minimum-
// sample-size classification logic -- mirrored at the database layer only
// by the raw aggregation query (`get_dish_performance_stats()`, see
// supabase/migrations/20260818100000_dish_performance_stats.sql), which
// deliberately does NOT itself decide "topseller"/"low performer" -- that
// decision lives here so it can be unit tested directly, per the ticket's
// "Unit-Test Mindestschwellenwert-Logik" + "Test für korrekte Mengen- vs.
// Umsatz-Unterscheidung" requirements, without needing a database at all.
// This mirrors this repo's established "pure domain logic + DB query"
// split (packages/domain/src/cart/pricing.ts + build_cart_view(),
// packages/domain/src/orders/state-machine.ts + is_valid_order_status_transition()).
//
// Explicit non-goal (ticket #31): no automatic root-cause attribution (e.g.
// "the price is to blame") -- this module only ranks and classifies based on
// the evidence numbers it's given; it never infers or states a cause.

/** Raw per-dish aggregates for one reporting window, as returned by `get_dish_performance_stats()`. */
export interface DishPerformanceInput {
  dishId: string;
  dishName: string;
  /** Sum of order_items.quantity across non-cancelled, non-awaiting-payment orders in the window. */
  unitsSold: number;
  /** Sum of quantity * (unit_price_cents_snapshot + selected options' price_delta_cents_snapshot) across those same order_items. */
  revenueCents: number;
  /** ISO 4217 currency code this dish's prices/revenue are denominated in (from `get_dish_performance_stats()`'s per-dish `currency`, i.e. `dishes.currency`). */
  currency: string;
  /** Count of `dish_view` analytics_events in the window (0 if none were ever recorded -- honest, not fabricated). */
  viewsCount: number;
  /** Count of `add_to_cart` analytics_events in the window. */
  addToCartCount: number;
}

export type DishPerformanceLabel = "topseller" | "low_performer" | "insufficient_data" | "normal";

export interface DishPerformanceResult extends DishPerformanceInput {
  /** viewsCount + addToCartCount + unitsSold -- the combined evidence basis this dish has accumulated. */
  evidenceCount: number;
  /** unitsSold / viewsCount, or null when viewsCount is 0 (never a fabricated 0% -- there's no denominator to divide by). */
  conversionRate: number | null;
  /** 1 = best-selling by quantity. Ties broken by revenueCents desc, then dishId, for a deterministic order. */
  quantityRank: number;
  /** 1 = highest revenue. Same tie-break precedence as quantityRank. */
  revenueRank: number;
  label: DishPerformanceLabel;
}

export interface ClassifyDishPerformanceOptions {
  /**
   * Minimum combined evidence (`viewsCount + addToCartCount + unitsSold`) a
   * dish must have accumulated before it may ever be labeled `low_performer`
   * -- below this, it's always `insufficient_data` regardless of how low its
   * sales are (ticket #31 acceptance criterion 1: "Ein neues/selten
   * aufgerufenes Gericht wird nicht ohne ausreichende Datenbasis als 'Low
   * Performer' bezeichnet"). Configurable per the ticket's "konfigurierbarer
   * Mindestschwellenwert" requirement -- callers choose the value (see the
   * default export `DEFAULT_MIN_SAMPLE_SIZE` for this app's own default).
   */
  minSampleSize: number;
  /** Fraction (0, 1] of all dishes, ranked by quantity, labeled `topseller`. Default 0.2 (top 20%), rounded up, at least 1 if any dish has sales. */
  topsellerShare?: number;
  /** Fraction (0, 1] of dishes WITH sufficient data, ranked by quantity ascending, labeled `low_performer`. Default 0.2 (bottom 20% of the eligible set). */
  lowPerformerShare?: number;
}

/** This app's own default minimum sample size -- 10 combined evidence points (views + add-to-cart + units sold) in the reporting window. */
export const DEFAULT_MIN_SAMPLE_SIZE = 10;

function compareDescThenId(
  a: DishPerformanceInput,
  b: DishPerformanceInput,
  primary: (d: DishPerformanceInput) => number,
  secondary: (d: DishPerformanceInput) => number,
): number {
  const primaryDiff = primary(b) - primary(a);
  if (primaryDiff !== 0) return primaryDiff;
  const secondaryDiff = secondary(b) - secondary(a);
  if (secondaryDiff !== 0) return secondaryDiff;
  return a.dishId < b.dishId ? -1 : a.dishId > b.dishId ? 1 : 0;
}

/**
 * Ranks and classifies a tenant's dishes for one reporting window. Pure
 * function, no I/O -- see module header.
 */
export function classifyDishPerformance(
  dishes: readonly DishPerformanceInput[],
  options: ClassifyDishPerformanceOptions,
): DishPerformanceResult[] {
  if (dishes.length === 0) {
    return [];
  }

  if (!Number.isFinite(options.minSampleSize) || options.minSampleSize < 0) {
    throw new Error("minSampleSize must be a non-negative number");
  }

  const topsellerShare = options.topsellerShare ?? 0.2;
  const lowPerformerShare = options.lowPerformerShare ?? 0.2;

  const byQuantity = [...dishes].sort((a, b) =>
    compareDescThenId(
      a,
      b,
      (d) => d.unitsSold,
      (d) => d.revenueCents,
    ),
  );
  const byRevenue = [...dishes].sort((a, b) =>
    compareDescThenId(
      a,
      b,
      (d) => d.revenueCents,
      (d) => d.unitsSold,
    ),
  );

  const quantityRankByDishId = new Map<string, number>();
  byQuantity.forEach((d, index) => quantityRankByDishId.set(d.dishId, index + 1));

  const revenueRankByDishId = new Map<string, number>();
  byRevenue.forEach((d, index) => revenueRankByDishId.set(d.dishId, index + 1));

  const evidenceCountByDishId = new Map<string, number>();
  for (const d of dishes) {
    evidenceCountByDishId.set(d.dishId, d.viewsCount + d.addToCartCount + d.unitsSold);
  }

  const eligibleForLowPerformer = byQuantity.filter(
    (d) => (evidenceCountByDishId.get(d.dishId) ?? 0) >= options.minSampleSize,
  );

  // The bottom `lowPerformerShare` of the ELIGIBLE set (sorted by quantity,
  // worst last) -- a dish with insufficient data is never included in this
  // set at all, so it can never be counted toward or flagged as low
  // performer, no matter how few units it sold.
  const lowPerformerCount =
    eligibleForLowPerformer.length > 0
      ? Math.max(1, Math.ceil(eligibleForLowPerformer.length * lowPerformerShare))
      : 0;
  const lowPerformerDishIds = new Set(
    eligibleForLowPerformer.slice(-lowPerformerCount).map((d) => d.dishId),
  );

  // Topseller: top `topsellerShare` of ALL dishes by quantity, but only
  // among dishes that actually sold at least one unit AND have accumulated
  // at least `minSampleSize` combined evidence -- the same minimum-sample-
  // size gate as `low_performer` (a single lucky sale, with nothing else
  // ever recorded for that dish, must never be enough evidence to call it a
  // "Topseller" any more than it would be enough to call it a "Low
  // Performer"). A dish with zero sales, or with sales but insufficient
  // overall evidence, is never a "topseller".
  const dishesEligibleForTopseller = byQuantity.filter(
    (d) => d.unitsSold > 0 && (evidenceCountByDishId.get(d.dishId) ?? 0) >= options.minSampleSize,
  );
  const topsellerCount =
    dishesEligibleForTopseller.length > 0
      ? Math.max(1, Math.ceil(dishesEligibleForTopseller.length * topsellerShare))
      : 0;
  const topsellerDishIds = new Set(
    dishesEligibleForTopseller.slice(0, topsellerCount).map((d) => d.dishId),
  );

  return dishes.map((d) => {
    const evidenceCount = evidenceCountByDishId.get(d.dishId) ?? 0;
    const sufficientData = evidenceCount >= options.minSampleSize;

    let label: DishPerformanceLabel;
    if (!sufficientData) {
      label = "insufficient_data";
    } else if (topsellerDishIds.has(d.dishId)) {
      label = "topseller";
    } else if (lowPerformerDishIds.has(d.dishId)) {
      label = "low_performer";
    } else {
      label = "normal";
    }

    return {
      ...d,
      evidenceCount,
      conversionRate: d.viewsCount > 0 ? d.unitsSold / d.viewsCount : null,
      quantityRank: quantityRankByDishId.get(d.dishId)!,
      revenueRank: revenueRankByDishId.get(d.dishId)!,
      label,
    };
  });
}
