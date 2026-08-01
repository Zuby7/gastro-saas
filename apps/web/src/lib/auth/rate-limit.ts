/**
 * Fixed-window auth rate limiter -- pure logic, decoupled from Supabase so it
 * can be unit-tested with a fake in-memory store (see rate-limit.test.ts).
 * The real implementation (`supabase-rate-limit-store.ts`) is backed by the
 * `auth_rate_limit_attempts` table via an atomic RPC (see
 * supabase/migrations/20260801060000_auth_onboarding_rpc_and_rate_limiting.sql
 * and supabase/migrations/20260801070000_auth_rate_limit_atomic_and_login_audit_rpc.sql
 * for why a Postgres table + a single atomic function was chosen over an
 * in-memory counter or a check-then-act pair of queries).
 *
 * Design (ticket #7 fix cycle 1, replacing the original check-then-act,
 * email-alone-keyed, success-counting design):
 *
 * - **Atomic reserve-and-count**: `reserveAttempt()` records this attempt
 *   AND returns the in-window failure counts in one round-trip/DB
 *   transaction. The original design did a separate `SELECT count` then a
 *   separate `INSERT`, leaving a window where concurrent requests could all
 *   observe a stale "under the limit" count before any of them recorded an
 *   attempt.
 * - **Only failed attempts count**: a successful login never counts toward
 *   the limit (the store filters `succeeded = false` server-side, and a
 *   successful attempt is retroactively excluded via `markSucceeded()`).
 *   The original design counted successes too, so a legitimate user could
 *   lock themselves out after `maxAttempts` successful logins in the
 *   window.
 * - **Keyed by IP, and by (IP, email) -- never by email alone**: the
 *   original design also blocked once a single *email* reached
 *   `maxAttempts` failures regardless of source IP, which let any
 *   anonymous third party lock a known victim's email out of login for the
 *   whole window just by submitting `maxAttempts` wrong-password attempts
 *   against it (optionally rotating source IPs to also dodge the IP-only
 *   bucket) -- the attacker's cost was "know the victim's email", not
 *   "control a fixed IP". Keying on (ip) and (ip, email) instead still
 *   fully stops a single attacker IP from brute-forcing one account (or
 *   cycling through many), while never fully denying the victim's *own*
 *   login from their own, different IP.
 */

export type RateLimitScope = "login" | "register";

export interface RateLimitReservation {
  /** Id of the just-recorded attempt row; `null` if the store failed open. */
  attemptId: string | null;
  /** In-window failed-attempt count for this scope+ip, including this attempt. */
  ipCount: number;
  /** In-window failed-attempt count for this scope+ip+email, including this attempt. */
  ipEmailCount: number;
}

export interface RateLimitStore {
  /**
   * Atomically records one (initially "failed") attempt for
   * `scope`/`ip`/`email` and returns the in-window failure counts for both
   * the `ip`-only bucket and the `(ip, email)` bucket, including the
   * just-recorded attempt. Must be a single atomic operation so concurrent
   * callers can never all observe a stale "under the limit" count.
   */
  reserveAttempt(
    scope: RateLimitScope,
    ip: string,
    email: string,
    windowSeconds: number,
  ): Promise<RateLimitReservation>;

  /**
   * Marks a previously reserved attempt as succeeded, excluding it from
   * future failure counts. Call this only once the real operation (sign-in)
   * the attempt was reserved for has actually succeeded.
   */
  markSucceeded(attemptId: string | null): Promise<void>;
}

export interface RateLimitCheck {
  scope: RateLimitScope;
  ip: string;
  email: string;
  /** Attempts allowed per window before further attempts are blocked. */
  maxAttempts: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  limited: boolean;
  /** Pass to `store.markSucceeded()` if the guarded operation succeeds. */
  attemptId: string | null;
}

/**
 * Reserves (records) this attempt and, in the same atomic round-trip,
 * checks whether either the calling IP or the specific (ip, email)
 * combination has already reached `maxAttempts` failed attempts within the
 * trailing `windowSeconds`.
 */
export async function reserveAndCheckRateLimit(
  store: RateLimitStore,
  check: RateLimitCheck,
): Promise<RateLimitResult> {
  const { attemptId, ipCount, ipEmailCount } = await store.reserveAttempt(
    check.scope,
    check.ip,
    check.email,
    check.windowSeconds,
  );

  return {
    attemptId,
    limited: ipCount > check.maxAttempts || ipEmailCount > check.maxAttempts,
  };
}
