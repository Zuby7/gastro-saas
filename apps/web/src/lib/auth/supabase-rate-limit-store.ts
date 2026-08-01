import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimitScope, RateLimitStore } from "./rate-limit";

/**
 * `RateLimitStore` backed by the `auth_rate_limit_attempts` table (ticket #7
 * migration), written/read exclusively through the service-role admin
 * client (`lib/supabase/admin.ts`) -- this table has no RLS grants for
 * `anon`/`authenticated` by design (see the migration's header comment).
 */
export function createSupabaseRateLimitStore(admin: SupabaseClient): RateLimitStore {
  return {
    async countAttempts(scope, field, value, sinceIso) {
      const { count, error } = await admin
        .from("auth_rate_limit_attempts")
        .select("id", { count: "exact", head: true })
        .eq("scope", scope)
        .eq(field, value)
        .gte("attempted_at", sinceIso);

      if (error) {
        // Fail *open* on a transient DB error rather than blocking all auth
        // traffic on it -- this rate limiter is defense-in-depth, not the
        // only brute-force mitigation (Supabase Auth/GoTrue applies its own
        // throttling independently). Logged server-side for visibility.
        console.error("[auth-rate-limit] count query failed", error);
        return 0;
      }

      return count ?? 0;
    },

    async recordAttempt(scope: RateLimitScope, ip: string, email: string, succeeded: boolean) {
      const { error } = await admin
        .from("auth_rate_limit_attempts")
        .insert({ scope, ip, email, succeeded });

      if (error) {
        console.error("[auth-rate-limit] recording attempt failed", error);
      }
    },
  };
}
