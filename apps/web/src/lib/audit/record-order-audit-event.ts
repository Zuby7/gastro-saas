import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSafeAuditMetadata } from "@gastro-saas/domain";

/**
 * Appends one `audit_logs` row for a guest-facing order event (checkout,
 * and future Epic 8 staff-driven status transitions) -- ticket #21's
 * "Auswirkungen" note ("Bestellstatus-Änderungen auditiert").
 *
 * Unlike `recordMenuAdminAuditEvent` (which inserts through the acting
 * tenant member's own authenticated, RLS-scoped session client), an order
 * checkout has no authenticated session at all -- it's a guest path
 * (`docs/security/tenant-isolation.md` Layer 0). This helper therefore
 * takes the service-role admin client (already resolved tenant_id
 * server-side from the route slug, never a client-supplied value) and
 * writes with `actor_user_id: null`, which `audit_logs`' schema and RLS
 * design already accommodate (see
 * `supabase/migrations/20260801050000_audit_log_and_analytics_events_skeleton.sql`,
 * `actor_user_id` is nullable; `service_role` already holds `select, insert`
 * on `audit_logs`).
 *
 * Audit logging must never break the mutation it's attached to -- failures
 * are caught and logged, never thrown, matching
 * `recordMenuAdminAuditEvent`'s established tolerance.
 */
export async function recordOrderAuditEvent(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    action: string;
    targetType: "order";
    targetId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    if (input.metadata !== undefined) {
      assertSafeAuditMetadata(input.metadata);
    }

    const { error } = await supabase.from("audit_logs").insert({
      tenant_id: input.tenantId,
      actor_user_id: null,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      metadata: input.metadata ?? {},
    });

    if (error) {
      console.error("[audit] failed to record order audit event", input.action, error);
    }
  } catch (error) {
    console.error("[audit] failed to record order audit event", input.action, error);
  }
}
