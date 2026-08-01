import { recordAuditEvent } from "@gastro-saas/domain";
import { auditQueryClient, getAuditDbPool } from "./audit-client";

/**
 * Records a failed login attempt via `recordAuditEvent()` (ticket #6),
 * attributed to the tenant of the first membership found for the attempted
 * email.
 *
 * Design decision (ticket #7 acceptance criterion: "failed login attempts
 * are audited"): `audit_logs.tenant_id` is `NOT NULL`
 * (supabase/migrations/20260801050000_audit_log_and_analytics_events_skeleton.sql)
 * -- it is a tenant-scoped table by design, not a general system event log.
 * A failed login attempt against an email that does not resolve to any
 * existing tenant membership (unknown account, or a Supabase Auth user with
 * no tenant yet) therefore has no tenant to attribute an audit_logs row to.
 * Rather than inventing a synthetic "system tenant" sentinel (which would
 * need its own fake Owner membership just to satisfy the
 * tenants_created_with_owner invariant, and would mix unrelated tenants'
 * failed-login noise into one shared, meaningless tenant_id), that case is
 * intentionally skipped here: it is still captured for brute-force
 * detection via `auth_rate_limit_attempts` (tenant-agnostic, written
 * regardless of whether the email resolves to anything), just not written
 * to the tenant-scoped `audit_logs` table.
 *
 * Known limitation: a user with memberships in more than one tenant (not
 * possible yet in this ticket's scope -- only the invitation flow, ticket
 * #8, can add a second membership) would only have the failed attempt
 * attributed to one arbitrarily-chosen tenant. Acceptable for this ticket;
 * revisit if/when ticket #8 makes multi-tenant membership common.
 */
export async function recordFailedLoginAttempt(email: string): Promise<void> {
  try {
    const pool = getAuditDbPool();
    const result = await pool.query<{ tenant_id: string; user_id: string }>(
      `select tm.tenant_id as tenant_id, u.id as user_id
       from auth.users u
       join public.tenant_memberships tm on tm.user_id = u.id
       where u.email = $1
       limit 1`,
      [email],
    );

    const match = result.rows[0];
    if (!match) {
      return;
    }

    await recordAuditEvent(auditQueryClient, {
      tenantId: match.tenant_id,
      actorUserId: match.user_id,
      action: "auth.login.failed",
      targetType: "user",
      targetId: match.user_id,
    });
  } catch (error) {
    // Audit logging must never break the login flow itself.
    console.error("[audit] failed to record failed login attempt", error);
  }
}
