"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CreateTenantSchema } from "@/lib/auth/schemas";

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export interface CreateTenantFormState {
  error?: string;
  fieldErrors?: Partial<Record<"tenantName" | "tenantSlug", string>>;
}

/**
 * Onboarding-completion fallback (ticket #7 fix cycle 1, item 4/5): lets a
 * logged-in user with zero tenant memberships create their tenant via the
 * same `create_tenant_with_owner` RPC used at registration time, using the
 * *current* authenticated session (the RPC resolves the owner from
 * `auth.uid()`, never a client-supplied id -- see the RPC's own migration
 * comment).
 *
 * Covers two cases that would otherwise be dead ends:
 * - registration's `signUp()` succeeded but `create_tenant_with_owner()`
 *   failed (e.g. a slug conflict), leaving an auth user with no tenant and
 *   no way to complete onboarding via the registration form again (retrying
 *   registration with the same email just reports "already registered");
 * - `auth.email.enable_confirmations = true` (the expected production
 *   posture): registration's `signUp()` returns no session, so
 *   `create_tenant_with_owner()` never ran at signup time at all -- the
 *   user's first login after confirming their email lands here instead.
 */
export async function createTenantAction(
  _prevState: CreateTenantFormState,
  formData: FormData,
): Promise<CreateTenantFormState> {
  const parsed = CreateTenantSchema.safeParse({
    tenantName: formData.get("tenantName"),
    tenantSlug: formData.get("tenantSlug"),
  });

  if (!parsed.success) {
    const fieldErrors: CreateTenantFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in fieldErrors)) {
        (fieldErrors as Record<string, string>)[field] = issue.message;
      }
    }
    return { error: "Bitte korrigieren Sie die markierten Felder.", fieldErrors };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error: rpcError } = await supabase.rpc("create_tenant_with_owner", {
    p_tenant_name: parsed.data.tenantName,
    p_tenant_slug: parsed.data.tenantSlug,
  });

  if (rpcError) {
    const slugTaken =
      rpcError.code === "23505" || rpcError.message.toLowerCase().includes("duplicate");
    return {
      error: slugTaken
        ? "Dieser Restaurant-Slug ist bereits vergeben. Bitte wählen Sie einen anderen."
        : "Ihr Restaurant konnte nicht angelegt werden. Bitte versuchen Sie es erneut.",
      fieldErrors: slugTaken ? { tenantSlug: "Dieser Slug ist bereits vergeben." } : undefined,
    };
  }

  redirect("/account");
}
