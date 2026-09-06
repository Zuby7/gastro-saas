import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyDishPerformance,
  DEFAULT_MIN_SAMPLE_SIZE,
  type DishPerformanceInput,
  type DishPerformanceResult,
} from "@gastro-saas/domain";

/**
 * Topseller-/Low-Performer-Analyse (ticket #31, Epic 9). Thin wrapper around
 * the `get_dish_performance_stats` RPC (see
 * `supabase/migrations/20260818100000_dish_performance_stats.sql`), which is
 * also this feature's actual authorization enforcement point: the function
 * itself calls `require_tenant_permission(tenant_id, 'analytics.read')`
 * before reading anything. Ranking/classification (topseller/low performer/
 * insufficient data) is pure logic in `@gastro-saas/domain`'s
 * `classifyDishPerformance()`, applied here to the raw stats -- see that
 * module's header for why this split exists.
 */
export interface RawDishStatsRow {
  dishId: string;
  dishName: string;
  categoryId: string;
  priceCents: number | null;
  currency: string;
  unitsSold: number;
  revenueCents: number;
  viewsCount: number;
  addToCartCount: number;
  /** Ticket #58: manually logged (external-channel/walk-in) units sold, ADDITIVE -- never folded into unitsSold above. */
  manualUnitsSold: number;
  /** Ticket #58: an ESTIMATE of manual sales revenue (current dish price * quantity), never folded into revenueCents above. */
  manualEstimatedRevenueCents: number;
}

/**
 * Ticket #58: `DishPerformanceResult` (real-order-derived ranking/
 * classification) plus the additive, clearly-separate manual sales figures.
 * Deliberately NOT fed into `classifyDishPerformance()`'s inputs below --
 * ranking/topseller/low-performer classification only ever uses real
 * `unitsSold`/`revenueCents`, so a tenant can never inflate a dish's ranking
 * by logging manual entries.
 */
export interface DishPerformanceWithManualSales extends DishPerformanceResult {
  manualUnitsSold: number;
  manualEstimatedRevenueCents: number;
}

export async function getDishPerformanceAnalysis(
  supabase: SupabaseClient,
  tenantId: string,
  options: { daysBack?: number; minSampleSize?: number } = {},
): Promise<DishPerformanceWithManualSales[]> {
  const { data, error } = await supabase.rpc("get_dish_performance_stats", {
    p_tenant_id: tenantId,
    p_days_back: options.daysBack ?? 30,
  });

  if (error) {
    throw error;
  }

  const rawStats = (data as RawDishStatsRow[]) ?? [];
  const inputs: DishPerformanceInput[] = rawStats.map((row) => ({
    dishId: row.dishId,
    dishName: row.dishName,
    unitsSold: row.unitsSold,
    revenueCents: row.revenueCents,
    currency: row.currency,
    viewsCount: row.viewsCount,
    addToCartCount: row.addToCartCount,
  }));

  const manualByDishId = new Map(
    rawStats.map((row) => [
      row.dishId,
      {
        manualUnitsSold: row.manualUnitsSold,
        manualEstimatedRevenueCents: row.manualEstimatedRevenueCents,
      },
    ]),
  );

  const classified = classifyDishPerformance(inputs, {
    minSampleSize: options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE,
  });

  return classified.map((result) => ({
    ...result,
    ...(manualByDishId.get(result.dishId) ?? {
      manualUnitsSold: 0,
      manualEstimatedRevenueCents: 0,
    }),
  }));
}
