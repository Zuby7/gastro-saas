import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSafeAuditMetadata } from "@gastro-saas/domain";

/**
 * Appends one `audit_logs` row for a tenant-admin mutation (restaurant
 * profile, dish create/archive, image upload, ...), per tickets #11/#12's
 * "mutations must be audited" requirement (`docs/data/domain-model.md`
 * "Audit") -- Opus cycle-3 review, artifacts/reviews/epic-3-5-batch.json.
 *
 * Deliberately does NOT go through `recordAuditEvent()` in
 * `packages/domain/src/audit` directly: that function's `AuditQueryClient`
 * interface expects a raw parameterized-SQL-capable client (`query(sql,
 * params)`), which in this app's request path would mean either a raw `pg`
 * connection (the exact superuser-bypasses-RLS anti-pattern ticket #7 fix
 * cycle 1 already removed from the login-audit path, see
 * `apps/web/src/lib/audit/login-audit.ts`) or a service-role client (more
 * privilege than this call site needs). These server actions already hold
 * an authenticated, RLS-scoped Supabase client for the acting user -- the
 * `audit_logs_insert_member` RLS policy
 * (`supabase/migrations/20260801050000_audit_log_and_analytics_events_skeleton.sql`)
 * already permits a tenant member to insert an audit row for their own
 * tenant with themselves as the actor, so a plain `.from("audit_logs").insert()`
 * through that same session client is the least-privilege option here.
 * This helper still reuses `assertSafeAuditMetadata()` (the same
 * secret-/payment-shape guard `recordAuditEvent()` uses) so metadata is
 * validated identically either way.
 *
 * Audit logging must never break the mutation it's attached to -- failures
 * are caught and logged, never thrown, matching the fire-and-forget
 * tolerance already established for `recordFailedLoginAttempt()`.
 */
export async function recordMenuAdminAuditEvent(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    actorUserId: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    if (input.metadata !== undefined) {
      assertSafeAuditMetadata(input.metadata);
    }

    const { error } = await supabase.from("audit_logs").insert({
      tenant_id: input.tenantId,
      actor_user_id: input.actorUserId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId ?? null,
      metadata: input.metadata ?? {},
    });

    if (error) {
      console.error("[audit] failed to record audit event", input.action, error);
    }
  } catch (error) {
    console.error("[audit] failed to record audit event", input.action, error);
  }
}
