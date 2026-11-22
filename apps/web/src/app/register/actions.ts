"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseRateLimitStore } from "@/lib/auth/supabase-rate-limit-store";
import { reserveAndCheckRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/auth/client-ip";
import { RegisterSchema } from "@/lib/auth/schemas";
import { padToFloor } from "@/lib/timing/floor";
import { isTenantSlugTaken } from "@/lib/tenant/slug-availability";
import { ACCOUNT_NOTICE_PARAM } from "@/lib/tenant/account-notices";

/**
 * Issue #204: one message for "new address, confirmation mail sent" and
 * "address already has an account". It must stay truthful for both, which is
 * why it is conditional ("Falls ...") rather than a flat "we sent you a mail".
 */
const NEUTRAL_REGISTRATION_INFO =
  "Falls diese E-Mail-Adresse noch nicht registriert ist, haben wir Ihnen einen Bestätigungslink geschickt. Bitte prüfen Sie Ihr Postfach und melden Sie sich nach der Bestätigung an, um Ihr Restaurant anzulegen. Falls Sie bereits ein Konto haben, melden Sie sich bitte direkt an.";

/**
 * Same mitigation as login's LOGIN_FAILURE_FLOOR_MS (lib/timing/floor.ts):
 * signUp() does different amounts of work for a new address (password hash,
 * confirmation mail) than for an existing one, so every non-redirecting
 * outcome is padded to a common floor. Higher than login's 200 ms because
 * the new-address path includes handing a mail to the provider.
 */
const REGISTER_RESPONSE_FLOOR_MS = 500;

async function neutralOutcome(
  startedAt: number,
  rateLimitStore: { markSucceeded: (attemptId: string | null) => Promise<unknown> },
  attemptId: string | null,
): Promise<RegisterFormState> {
  // signUp() itself did not fail, so this is not a failed attempt (Codex
  // review fix: legitimate confirm-email registrations must not
  // self-throttle). Applied to the existing-address case as well, otherwise
  // the rate limit would trip sooner for existing addresses and leak the
  // very thing the neutral message hides.
  await rateLimitStore.markSucceeded(attemptId);
  await padToFloor(startedAt, REGISTER_RESPONSE_FLOOR_MS);
  return { info: NEUTRAL_REGISTRATION_INFO };
}

export interface RegisterFormState {
  error?: string;
  /** Non-error informational message (e.g. "check your email to confirm"). */
  info?: string;
  fieldErrors?: Partial<
    Record<"tenantName" | "tenantSlug" | "email" | "password" | "acceptTerms", string>
  >;
}

/**
 * Registration server action: validates input, rate-limits, creates the
 * Supabase Auth user, then atomically creates the tenant + Owner membership
 * via the `create_tenant_with_owner` RPC (ticket #7 migration) using the
 * *same authenticated session* `signUp()` just established -- the RPC
 * resolves the owner from `auth.uid()` itself, never a client-supplied id.
 */
export async function registerAction(
  _prevState: RegisterFormState,
  formData: FormData,
): Promise<RegisterFormState> {
  const startedAt = Date.now();

  const parsed = RegisterSchema.safeParse({
    tenantName: formData.get("tenantName"),
    tenantSlug: formData.get("tenantSlug"),
    email: formData.get("email"),
    password: formData.get("password"),
    acceptTerms: formData.get("acceptTerms") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: RegisterFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in fieldErrors)) {
        (fieldErrors as Record<string, string>)[field] = issue.message;
      }
    }
    return { error: "Bitte korrigieren Sie die markierten Felder.", fieldErrors };
  }

  const { tenantName, tenantSlug, email, password } = parsed.data;
  const ip = await getClientIp();
  const admin = createSupabaseAdminClient();
  const rateLimitStore = createSupabaseRateLimitStore(admin);

  const { limited, attemptId } = await reserveAndCheckRateLimit(rateLimitStore, {
    scope: "register",
    ip,
    email,
    maxAttempts: 5,
    // Explicit and deliberately equal to maxAttempts (no widening) -- Opus
    // review finding on PR #101: ticket #62's shared-IP/CGNAT concern was
    // scoped to the login lockout only. Relying on
    // reserveAndCheckRateLimit's default multiplier here would have
    // silently loosened this scope's IP-only threshold too, which was never
    // part of that ticket. The shared-IP/CGNAT concern for the invite scope
    // (ticket #71) is handled separately in account/actions.ts.
    maxIpAttempts: 5,
    windowSeconds: 60 * 60,
  });
  if (limited) {
    return {
      error: "Zu viele Registrierungsversuche. Bitte versuchen Sie es in einer Stunde erneut.",
    };
  }

  // Check the web address BEFORE signUp: otherwise a slug conflict happens
  // after the auth user exists, the user fixes the slug, resubmits and then
  // hits the (intentionally neutral) "already registered" answer, a dead end.
  // This says nothing about the e-mail address, so it keeps the enumeration
  // neutrality; the RPC's unique constraint below stays the race backstop.
  if (await isTenantSlugTaken(admin, tenantSlug)) {
    await padToFloor(startedAt, REGISTER_RESPONSE_FLOOR_MS);
    return {
      error: "Bitte korrigieren Sie die markierten Felder.",
      fieldErrors: {
        tenantSlug: "Diese Web-Adresse ist bereits vergeben. Bitte wählen Sie eine andere.",
      },
    };
  }

  const supabase = await createSupabaseServerClient();
  // Ticket #60: carry the tenant name/slug through Supabase's email
  // confirmation flow via `user_metadata` (set here through signUp's
  // `options.data`). With `enable_confirmations = true`, the values entered
  // on this form would otherwise be discarded -- the user would have to
  // retype them at the /account fallback after confirming their email. The
  // /account page reads them back out of `user.user_metadata` to prefill
  // that fallback form.
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { tenant_name: tenantName, tenant_slug: tenantSlug } },
  });

  if (signUpError) {
    // Issue #204: only the specific "already registered" error (which
    // Supabase returns when email confirmations are disabled) is folded into
    // the neutral outcome below. Every other signUp failure stays a generic
    // error that says nothing about the address.
    const alreadyRegistered = signUpError.message.toLowerCase().includes("already registered");
    if (alreadyRegistered) {
      return neutralOutcome(startedAt, rateLimitStore, attemptId);
    }

    await padToFloor(startedAt, REGISTER_RESPONSE_FLOOR_MS);
    return {
      error:
        "Registrierung nicht möglich. Bitte überprüfen Sie Ihre Eingaben und versuchen Sie es erneut.",
    };
  }

  // With email confirmations enabled (the expected production posture, see
  // docs/decisions/assumptions.md) Supabase answers a signUp for an existing
  // address with an obfuscated user that has no identities, and a signUp for
  // a new address with a user but no session. Both get the exact same
  // response here, so the form cannot be used to test whether an address has
  // an account (issue #204, docs/security/threat-model.md "Enumeration").
  //
  // For the new-address case tenant creation is deferred to the first
  // confirmed sign-in (ticket #7 fix cycle 1, item 5): create_tenant_with_owner()
  // resolves the owner from auth.uid() and there is no session yet. /account's
  // "create your restaurant" fallback completes onboarding then, and the same
  // fallback serves an existing account that never got a tenant.
  const existingAccount = signUpData.user?.identities?.length === 0;
  if (existingAccount || !signUpData.session) {
    return neutralOutcome(startedAt, rateLimitStore, attemptId);
  }

  const { error: rpcError } = await supabase.rpc("create_tenant_with_owner", {
    p_tenant_name: tenantName,
    p_tenant_slug: tenantSlug,
  });

  if (rpcError) {
    // The auth user and session already exist, so an error message here would
    // strand the user in a loop (resubmitting hits "already registered").
    // Hand over to /account, whose "create your restaurant" form is prefilled
    // from the user_metadata stored at signUp and explains what happened.
    const slugTaken =
      rpcError.code === "23505" || rpcError.message.toLowerCase().includes("duplicate");
    await rateLimitStore.markSucceeded(attemptId);
    redirect(
      `/account?${ACCOUNT_NOTICE_PARAM}=${slugTaken ? "tenant-slug-taken" : "tenant-create-failed"}`,
    );
  }

  await rateLimitStore.markSucceeded(attemptId);

  redirect("/account");
}
