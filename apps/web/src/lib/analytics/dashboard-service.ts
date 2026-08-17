import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Analytics dashboard summary (ticket #30, Epic 9). Thin typed wrapper around
 * the `get_analytics_dashboard_summary` RPC (see
 * `supabase/migrations/20260818090000_analytics_dashboard_summary.sql`),
 * which is also this feature's actual authorization enforcement point: the
 * function itself calls `require_tenant_permission(tenant_id, 'analytics.read')`
 * before reading anything, so a missing/insufficient permission surfaces here
 * as a thrown Postgres error (`insufficient_privilege`), not a silently empty
 * result. Callers should still call `requireTenantPermission` beforehand too
 * (this repo's two-enforcement-layers convention, see
 * `.claude/rules/tenant-isolation.md`) purely to render a clear
 * access-denied UI state before ever calling this RPC -- see
 * `apps/web/src/app/account/analytics/page.tsx`.
 */
export interface AnalyticsDashboardSummary {
  timezone: string;
  dayStart: string;
  dayEnd: string;
  currency: string;
  grossRevenueTodayCents: number;
  refundsTodayCents: number;
  netRevenueTodayCents: number;
  paidOrdersTodayCount: number;
  /** `null` when there were no paid orders today -- never a fabricated 0 (ticket #30 acceptance criterion 3). */
  avgOrderValueCents: number | null;
  openOrdersCount: number;
  paymentFailuresTodayCount: number;
}

export async function getAnalyticsDashboardSummary(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<AnalyticsDashboardSummary> {
  const { data, error } = await supabase.rpc("get_analytics_dashboard_summary", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  return data as AnalyticsDashboardSummary;
}
