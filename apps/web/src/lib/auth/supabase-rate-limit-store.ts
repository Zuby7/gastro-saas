import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimitReservation, RateLimitScope, RateLimitStore } from "./rate-limit";

interface ReserveAttemptRow {
  attempt_id: string;
  ip_count: number;
  ip_email_count: number;
}

/**
 * `RateLimitStore` backed by the `auth_rate_limit_attempts` table (ticket #7
 * migration), accessed exclusively through two atomic, `SECURITY DEFINER`
 * RPCs (`reserve_auth_rate_limit_attempt` / `mark_auth_rate_limit_attempt_succeeded`,
 * see supabase/migrations/20260801070000_auth_rate_limit_atomic_and_login_audit_rpc.sql)
 * called via the service-role admin client -- this table has no RLS grants
 * for `anon`/`authenticated` by design (see the migrations' header
 * comments). Using RPCs rather than direct `select`/`insert` calls is what
 * makes the reserve-and-count step atomic across concurrent requests (see
 * `rate-limit.ts`'s header comment for the "check-then-act" fix this
 * replaces).
 */
export function createSupabaseRateLimitStore(admin: SupabaseClient): RateLimitStore {
  return {
    async reserveAttempt(
      scope: RateLimitScope,
      ip: string,
      email: string,
      windowSeconds: number,
    ): Promise<RateLimitReservation> {
      const { data, error } = await admin
        .rpc("reserve_auth_rate_limit_attempt", {
          p_scope: scope,
          p_ip: ip,
          p_email: email,
          p_window_seconds: windowSeconds,
        })
        .single<ReserveAttemptRow>();

      if (error || !data) {
        // Fail *open* on a transient DB error rather than blocking all auth
        // traffic on it -- this rate limiter is defense-in-depth, not the
        // only brute-force mitigation (Supabase Auth/GoTrue applies its own
        // throttling independently). Logged server-side for visibility.
        console.error("[auth-rate-limit] reserve attempt failed", error);
        return { attemptId: null, ipCount: 0, ipEmailCount: 0 };
      }

      return {
        attemptId: data.attempt_id,
        ipCount: data.ip_count,
        ipEmailCount: data.ip_email_count,
      };
    },

    async markSucceeded(attemptId: string | null) {
      if (!attemptId) {
        return;
      }

      const { error } = await admin.rpc("mark_auth_rate_limit_attempt_succeeded", {
        p_attempt_id: attemptId,
      });

      if (error) {
        console.error("[auth-rate-limit] marking attempt succeeded failed", error);
      }
    },
  };
}
