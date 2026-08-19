import type { SupabaseClient } from "@supabase/supabase-js";
import {
  analyzeExtrasPerformance,
  type ExtraPerformanceInput,
  type ExtraPerformanceResult,
} from "@gastro-saas/domain";

/**
 * Extras-Auswertung (ticket #32, Epic 9, acceptance criterion 2). Thin
 * wrapper around the `get_extras_performance_stats` RPC (see
 * `supabase/migrations/20260818110000_trend_and_extras_analytics.sql`),
 * which is also this feature's actual authorization enforcement point.
 * Selection-rate math is pure logic in `@gastro-saas/domain`'s
 * `analyzeExtrasPerformance()`, applied here to the raw per-option stats.
 *
 * Removed-ingredient analysis is NOT implemented -- see the migration's
 * header and `docs/data/domain-model.md` "Analytics" for why.
 */
export async function getExtrasPerformance(
  supabase: SupabaseClient,
  tenantId: string,
  daysBack = 30,
): Promise<ExtraPerformanceResult[]> {
  const { data, error } = await supabase.rpc("get_extras_performance_stats", {
    p_tenant_id: tenantId,
    p_days_back: daysBack,
  });

  if (error) {
    throw error;
  }

  const rawStats = (data as ExtraPerformanceInput[]) ?? [];
  return analyzeExtrasPerformance(rawStats);
}
