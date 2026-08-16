"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseRateLimitStore } from "@/lib/auth/supabase-rate-limit-store";
import { reserveAndCheckRateLimit } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/auth/client-ip";
import { RegisterSchema } from "@/lib/auth/schemas";

export interface RegisterFormState {
  error?: string;
  /** Non-error informational message (e.g. "check your email to confirm"). */
  info?: string;
  fieldErrors?: Partial<Record<"tenantName" | "tenantSlug" | "email" | "password", string>>;
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
  const parsed = RegisterSchema.safeParse({
    tenantName: formData.get("tenantName"),
    tenantSlug: formData.get("tenantSlug"),
    email: formData.get("email"),
    password: formData.get("password"),
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
    windowSeconds: 60 * 60,
  });
  if (limited) {
    return {
      error: "Zu viele Registrierungsversuche. Bitte versuchen Sie es in einer Stunde erneut.",
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
    // Registration duplicate-email disclosure is accepted UX here (this
    // ticket's enumeration-safety acceptance criterion targets LOGIN
    // failures specifically -- see docs/security/threat-model.md
    // "Enumeration": "no email exists leaks beyond what's necessary for
    // UX", and telling a user their own email is already registered during
    // signup is normal, necessary UX).
    //
    // Ticket #7 fix cycle 1, item 4: an "already registered" email might
    // belong to an orphaned auth user (a previous signUp() succeeded but
    // create_tenant_with_owner() failed, e.g. slug conflict) -- pointing
    // them at /login rather than a dead end lets the /account fallback
    // (item 4/5) complete onboarding for that same account.
    const alreadyRegistered = signUpError.message.toLowerCase().includes("already registered");

    return {
      error: alreadyRegistered
        ? "Diese E-Mail-Adresse ist bereits registriert. Bitte melden Sie sich an, um Ihr Restaurant anzulegen oder fortzufahren."
        : "Registrierung nicht möglich. Bitte überprüfen Sie Ihre Eingaben und versuchen Sie es erneut.",
    };
  }

  if (signUpData.user && signUpData.user.identities?.length === 0) {
    return {
      error:
        "Diese E-Mail-Adresse ist bereits registriert. Bitte melden Sie sich an, um Ihr Restaurant anzulegen oder fortzufahren.",
    };
  }

  if (!signUpData.session) {
    // Ticket #7 fix cycle 1, item 5: with `auth.email.enable_confirmations
    // = true` (the expected production posture -- local dev currently runs
    // with it `false`, see supabase/config.toml and
    // docs/decisions/assumptions.md), signUp() creates the auth.users row
    // but establishes no session, so create_tenant_with_owner() (which
    // resolves the owner from auth.uid()) cannot run yet. Tenant creation
    // is deferred to the user's first confirmed sign-in: loginAction's
    // redirect to /account lands on a session with zero tenant
    // memberships, and /account's "create your restaurant" fallback
    // (item 4) lets them create the tenant then -- this is not a dead end,
    // just a later step.
    //
    // Codex review fix: signUp() itself succeeded here -- this is not a
    // failed attempt, so it must not count toward the rate limit (otherwise
    // legitimate confirm-email registrations self-throttle).
    await rateLimitStore.markSucceeded(attemptId);
    return {
      info: "Bitte bestätigen Sie Ihre E-Mail-Adresse über den Link, den wir Ihnen geschickt haben. Melden Sie sich danach an, um Ihr Restaurant anzulegen.",
    };
  }

  const { error: rpcError } = await supabase.rpc("create_tenant_with_owner", {
    p_tenant_name: tenantName,
    p_tenant_slug: tenantSlug,
  });

  if (rpcError) {
    const slugTaken =
      rpcError.code === "23505" || rpcError.message.toLowerCase().includes("duplicate");
    return {
      error: slugTaken
        ? "Diese Web-Adresse ist bereits vergeben. Bitte wählen Sie eine andere."
        : "Ihr Konto wurde erstellt, aber Ihr Restaurant konnte nicht angelegt werden. Bitte melden Sie sich an, um es über Ihr Konto erneut zu versuchen.",
      fieldErrors: slugTaken
        ? { tenantSlug: "Diese Web-Adresse ist bereits vergeben." }
        : undefined,
    };
  }

  await rateLimitStore.markSucceeded(attemptId);

  redirect("/account");
}
