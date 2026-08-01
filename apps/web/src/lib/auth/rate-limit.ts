/**
 * Fixed-window auth rate limiter -- pure logic, decoupled from Supabase so it
 * can be unit-tested with a fake in-memory store (see rate-limit.test.ts).
 * The real implementation (`supabase-rate-limit-store.ts`) is backed by the
 * `auth_rate_limit_attempts` table (see
 * supabase/migrations/20260801060000_auth_onboarding_rpc_and_rate_limiting.sql
 * for why a Postgres table was chosen over an in-memory counter).
 */

export type RateLimitScope = "login" | "register";

export interface RateLimitStore {
  /** Number of attempts for `scope` where `field` = `value`, since `sinceIso`. */
  countAttempts(
    scope: RateLimitScope,
    field: "ip" | "email",
    value: string,
    sinceIso: string,
  ): Promise<number>;
  /** Records one attempt (successful or not) for `scope`. */
  recordAttempt(
    scope: RateLimitScope,
    ip: string,
    email: string,
    succeeded: boolean,
  ): Promise<void>;
}

export interface RateLimitCheck {
  scope: RateLimitScope;
  ip: string;
  email: string;
  /** Attempts allowed per window before further attempts are blocked. */
  maxAttempts: number;
  windowSeconds: number;
}

/**
 * True if either the IP or the email has reached `maxAttempts` for `scope`
 * within the trailing `windowSeconds`. Checking both independently means a
 * single IP can't work around the limit by rotating emails, and a single
 * email can't be brute-forced from many IPs without also eventually being
 * blocked by the email-scoped count.
 */
export async function isRateLimited(
  store: RateLimitStore,
  check: RateLimitCheck,
): Promise<boolean> {
  const sinceIso = new Date(Date.now() - check.windowSeconds * 1000).toISOString();

  const [byIp, byEmail] = await Promise.all([
    store.countAttempts(check.scope, "ip", check.ip, sinceIso),
    store.countAttempts(check.scope, "email", check.email, sinceIso),
  ]);

  return byIp >= check.maxAttempts || byEmail >= check.maxAttempts;
}
