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
 * - **IP-only threshold set well above the (IP, email) threshold** (ticket
 *   #62, Opus finding ticket #7 cycle 2): a single IP reaching `maxAttempts`
 *   failures *across different emails* used to hard-block the whole IP for
 *   the rest of the window -- on a shared office connection or CGNAT, one
 *   coworker mistyping their password a few times locked out everyone else
 *   behind the same IP. `maxIpAttempts` (defaulting to a generous multiple
 *   of `maxAttempts` when not given explicitly) keeps the IP-only bucket as
 *   a much looser backstop against IP-wide brute-forcing/credential
 *   stuffing across many accounts, while the tighter `maxAttempts`
 *   (IP, email) bucket still fully protects any single account from being
 *   brute-forced from that IP.
 */

export type RateLimitScope = "login" | "register" | "checkout";

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

/**
 * Fallback multiplier applied to `maxAttempts` ONLY when a caller doesn't
 * supply an explicit `maxIpAttempts`. Opus review finding on PR #101: every
 * *existing* caller (login, register, checkout) now passes `maxIpAttempts`
 * explicitly, specifically so this default can never silently change their
 * behavior -- ticket #62's shared-IP/CGNAT concern was scoped to the login
 * lockout only, and login is the only scope that actually widens its
 * IP-only threshold (to `maxAttempts * 4` = 20, set explicitly in
 * `login/actions.ts`, not via this default). register/checkout instead pin
 * `maxIpAttempts` equal to their own `maxAttempts` (no widening). This
 * constant now only matters as a conservative fallback for a future caller
 * that forgets to set `maxIpAttempts` at all -- it should not be read as
 * "the IP-only threshold for any scope in this codebase today".
 */
const DEFAULT_IP_THRESHOLD_MULTIPLIER = 4;

export interface RateLimitCheck {
  scope: RateLimitScope;
  ip: string;
  email: string;
  /**
   * Attempts allowed per window, per (ip, email) combination, before
   * further attempts for that specific account from that specific IP are
   * blocked.
   */
  maxAttempts: number;
  /**
   * Attempts allowed per window for the IP alone (i.e. across any number of
   * different emails attempted from that IP) before the IP itself is
   * blocked. Deliberately looser than `maxAttempts` (ticket #62) so a
   * shared/CGNAT IP with several legitimate users isn't hard-blocked by one
   * user's failed attempts against their own account. Defaults to
   * `maxAttempts * DEFAULT_IP_THRESHOLD_MULTIPLIER` if not given.
   */
  maxIpAttempts?: number;
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

  const maxIpAttempts = check.maxIpAttempts ?? check.maxAttempts * DEFAULT_IP_THRESHOLD_MULTIPLIER;

  return {
    attemptId,
    limited: ipCount > maxIpAttempts || ipEmailCount > check.maxAttempts,
  };
}
