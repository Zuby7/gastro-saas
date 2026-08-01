"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseRateLimitStore } from "@/lib/auth/supabase-rate-limit-store";
import { isRateLimited } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/auth/client-ip";
import { RegisterSchema } from "@/lib/auth/schemas";

export interface RegisterFormState {
  error?: string;
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

  const limited = await isRateLimited(rateLimitStore, {
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
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });

  await rateLimitStore.recordAttempt(
    "register",
    ip,
    email,
    Boolean(signUpData?.session) && !signUpError,
  );

  if (signUpError || !signUpData.session) {
    // Registration duplicate-email disclosure is accepted UX here (this
    // ticket's enumeration-safety acceptance criterion targets LOGIN
    // failures specifically -- see docs/security/threat-model.md
    // "Enumeration": "no email exists leaks beyond what's necessary for
    // UX", and telling a user their own email is already registered during
    // signup is normal, necessary UX).
    const alreadyRegistered =
      signUpError?.message.toLowerCase().includes("already registered") ||
      (signUpData?.user && signUpData.user.identities?.length === 0);

    return {
      error: alreadyRegistered
        ? "Diese E-Mail-Adresse ist bereits registriert. Bitte melden Sie sich stattdessen an."
        : "Registrierung nicht möglich. Bitte überprüfen Sie Ihre Eingaben und versuchen Sie es erneut.",
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
        ? "Dieser Restaurant-Slug ist bereits vergeben. Bitte wählen Sie einen anderen."
        : "Ihr Konto wurde erstellt, aber der Restaurant-Tenant konnte nicht angelegt werden. Bitte kontaktieren Sie den Support.",
      fieldErrors: slugTaken ? { tenantSlug: "Dieser Slug ist bereits vergeben." } : undefined,
    };
  }

  redirect("/account");
}
