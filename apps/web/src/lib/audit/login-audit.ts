import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Records a failed login attempt for `auth.login.failed`, attributed to the
 * tenant of the first membership found for the attempted email.
 *
 * Ticket #7 fix cycle 1: previously did this via a raw `pg` Pool connected
 * with `SUPABASE_DB_URL` (the Postgres **superuser** connection string)
 * directly from the web app's request path -- bypassing RLS entirely from
 * user-facing request handling (Opus finding, artifacts/reviews/issue-7.json
 * item 8). Now delegated entirely to `record_failed_login_audit_event()`, a
 * `SECURITY DEFINER` RPC (see
 * supabase/migrations/20260801070000_auth_rate_limit_atomic_and_login_audit_rpc.sql)
 * called through the existing service-role admin Supabase client -- the
 * same least-privilege pattern already used for the rate limiter, no direct
 * superuser Postgres connection needed from `apps/web` anymore.
 *
 * Callers must not `await` this in the request path that determines
 * response timing: it must run as fire-and-forget (`void
 * recordFailedLoginAttempt(...)`), otherwise its extra DB round-trip (which
 * only happens for emails that resolve to a real tenant membership) would
 * reopen the exact timing side channel this same fix cycle closed for the
 * overall login response (see login/actions.ts and
 * docs/security/threat-model.md "Enumeration").
 *
 * Known limitation: a user with memberships in more than one tenant would
 * only have the failed attempt attributed to one arbitrarily-chosen tenant
 * (unchanged from the original ticket #7 design -- see the RPC's own
 * comment).
 */
export async function recordFailedLoginAttempt(
  admin: SupabaseClient,
  email: string,
): Promise<void> {
  try {
    const { error } = await admin.rpc("record_failed_login_audit_event", { p_email: email });
    if (error) {
      console.error("[audit] failed to record failed login attempt", error);
    }
  } catch (error) {
    // Audit logging must never break the login flow itself.
    console.error("[audit] failed to record failed login attempt", error);
  }
}
