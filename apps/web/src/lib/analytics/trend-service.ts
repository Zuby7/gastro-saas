import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareTrendPeriods,
  type PeriodStats,
  type TrendComparisonResult,
} from "@gastro-saas/domain";

/**
 * Trendvergleiche (ticket #32, Epic 9). Thin wrapper around the
 * `get_trend_period_stats` RPC (see
 * `supabase/migrations/20260818110000_trend_and_extras_analytics.sql`),
 * which is also this feature's actual authorization enforcement point.
 * Presentation logic (percent change, "don't compare an incomplete period
 * uncommented") is pure logic in `@gastro-saas/domain`'s
 * `compareTrendPeriods()`, applied here to the raw period stats.
 */
export type TrendPeriodType = "day" | "week" | "month" | "custom";

export interface TrendComparisonOptions {
  periodType: TrendPeriodType;
  /** Required (and only used) when periodType === 'custom'. 'YYYY-MM-DD', inclusive start. */
  customStart?: string;
  /** Required (and only used) when periodType === 'custom'. 'YYYY-MM-DD', EXCLUSIVE end (the day after the last included day). */
  customEnd?: string;
}

export interface TrendComparison extends TrendComparisonResult {
  timezone: string;
  periodType: TrendPeriodType;
}

export async function getTrendComparison(
  supabase: SupabaseClient,
  tenantId: string,
  options: TrendComparisonOptions,
): Promise<TrendComparison> {
  const { data, error } = await supabase.rpc("get_trend_period_stats", {
    p_tenant_id: tenantId,
    p_period_type: options.periodType,
    p_custom_start: options.customStart ?? null,
    p_custom_end: options.customEnd ?? null,
  });

  if (error) {
    throw error;
  }

  const raw = data as {
    timezone: string;
    periodType: TrendPeriodType;
    currentPeriod: PeriodStats;
    previousPeriod: PeriodStats;
  };

  const comparison = compareTrendPeriods(raw.currentPeriod, raw.previousPeriod);

  return { ...comparison, timezone: raw.timezone, periodType: raw.periodType };
}
