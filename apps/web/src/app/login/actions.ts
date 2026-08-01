"use server";

import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseRateLimitStore } from "@/lib/auth/supabase-rate-limit-store";
import { isRateLimited } from "@/lib/auth/rate-limit";
import { getClientIp } from "@/lib/auth/client-ip";
import { recordFailedLoginAttempt } from "@/lib/audit/login-audit";
import { LoginSchema } from "@/lib/auth/schemas";

export interface LoginFormState {
  error?: string;
}

// Deliberately identical for "email not registered", "wrong password", and
// "input failed validation" -- a failed login must never disclose whether a
// given email exists (ticket #7 acceptance criterion,
// docs/security/threat-model.md "Enumeration").
const GENERIC_LOGIN_ERROR = "E-Mail-Adresse oder Passwort ist ungültig.";
const RATE_LIMIT_ERROR = "Zu viele Anmeldeversuche. Bitte versuchen Sie es später erneut.";

export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: GENERIC_LOGIN_ERROR };
  }

  const { email, password } = parsed.data;
  const ip = await getClientIp();
  const admin = createSupabaseAdminClient();
  const rateLimitStore = createSupabaseRateLimitStore(admin);

  const limited = await isRateLimited(rateLimitStore, {
    scope: "login",
    ip,
    email,
    maxAttempts: 5,
    windowSeconds: 15 * 60,
  });
  if (limited) {
    return { error: RATE_LIMIT_ERROR };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  await rateLimitStore.recordAttempt("login", ip, email, Boolean(data?.session) && !error);

  if (error || !data.session) {
    await recordFailedLoginAttempt(email);
    return { error: GENERIC_LOGIN_ERROR };
  }

  redirect("/account");
}
