"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseRateLimitStore } from "@/lib/auth/supabase-rate-limit-store";
import { reserveAndCheckRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/auth/client-ip";
import { recordFailedLoginAttempt } from "@/lib/audit/login-audit";
import { LoginSchema } from "@/lib/auth/schemas";
import { padToFloor } from "@/lib/timing/floor";

export interface LoginFormState {
  error?: string;
}

// Deliberately identical for "email not registered", "wrong password", and
// "input failed validation" -- a failed login must never disclose whether a
// given email exists (ticket #7 acceptance criterion,
// docs/security/threat-model.md "Enumeration").
const GENERIC_LOGIN_ERROR = "E-Mail-Adresse oder Passwort ist ungültig.";
const RATE_LIMIT_ERROR = "Zu viele Anmeldeversuche. Bitte versuchen Sie es später erneut.";

// Fixed minimum response-time floor applied to every FAILURE branch below
// (bad input, rate-limited, unknown email, wrong password) -- ticket #7 fix
// cycle 1 (Opus finding: measured 74ms for an existing-email wrong-password
// attempt, a real bcrypt verify, vs. 11ms for a nonexistent email, an early
// return -- a ~7x gap usable as an existence oracle despite identical error
// messages). Set comfortably above the real bcrypt-verify path's measured
// latency so all failure branches converge to (approximately) the same
// total response time regardless of which branch actually ran. Only the
// FAILURE branches are padded -- a successful login doesn't need it (the
// user already knows the account exists, there's nothing left to leak).
const LOGIN_FAILURE_FLOOR_MS = 200;

export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const startedAt = Date.now();

  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    await padToFloor(startedAt, LOGIN_FAILURE_FLOOR_MS);
    return { error: GENERIC_LOGIN_ERROR };
  }

  const { email, password } = parsed.data;
  const ip = await getClientIp();
  const admin = createSupabaseAdminClient();
  const rateLimitStore = createSupabaseRateLimitStore(admin);

  const { limited, attemptId } = await reserveAndCheckRateLimit(rateLimitStore, {
    scope: "login",
    ip,
    email,
    maxAttempts: 5,
    // Ticket #62: deliberately looser than maxAttempts (5 * 4) so a single
    // coworker's failed login attempts on a shared office/CGNAT IP don't
    // lock out everyone else behind that IP -- see rate-limit.ts's header
    // comment. Explicit here (not relying on reserveAndCheckRateLimit's
    // default) so this widening only ever applies to the login scope.
    maxIpAttempts: 20,
    windowSeconds: 15 * 60,
  });
  if (limited) {
    await padToFloor(startedAt, LOGIN_FAILURE_FLOOR_MS);
    return { error: RATE_LIMIT_ERROR };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    // Fire-and-forget, deliberately not awaited: this must never add
    // latency (or a distinguishing extra DB round-trip that only happens
    // for emails resolving to a real tenant) to this response -- see
    // login-audit.ts's own comment and the LOGIN_FAILURE_FLOOR_MS note
    // above.
    void recordFailedLoginAttempt(admin, email);
    await padToFloor(startedAt, LOGIN_FAILURE_FLOOR_MS);
    return { error: GENERIC_LOGIN_ERROR };
  }

  await rateLimitStore.markSucceeded(attemptId);

  redirect("/account");
}
