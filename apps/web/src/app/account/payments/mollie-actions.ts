"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";
import { isMolliePaypalEnabled, revokeMollieToken } from "@/lib/mollie/client";
import { decryptSecret } from "@/lib/mollie/crypto";
import { MollieNotConnectedError, getMollieAccessForTenant } from "@/lib/mollie/tokens";

export interface MollieActionFormState {
  error?: string;
  message?: string;
}

type Resolved =
  | {
      ok: true;
      userId: string;
      tenantId: string;
      supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
    }
  | { ok: false; error: string };

/**
 * Tenant and actor always come from the authenticated session; the
 * Owner-only `payments.connect` permission is re-checked server-side on every
 * Mollie mutation (the UI hiding the buttons is never authorization).
 */
async function resolveConnectActor(): Promise<Resolved> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return { ok: false, error: "Sie sind noch keinem Restaurant zugeordnet." };
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "payments.connect");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        ok: false,
        error: "Sie haben nicht die erforderliche Berechtigung, die PayPal-Verbindung zu ändern.",
      };
    }
    throw error;
  }

  return { ok: true, userId: user.id, tenantId: membership.tenantId, supabase };
}

/** Disconnects Mollie: best-effort token revocation at Mollie, then the row (and its tokens) is deleted. */
export async function disconnectMollieAction(
  _prev: MollieActionFormState,
  _formData: FormData,
): Promise<MollieActionFormState> {
  const actor = await resolveConnectActor();
  if (!actor.ok) {
    return { error: actor.error };
  }

  const admin = createSupabaseAdminClient();

  // Best effort: a revoke failure (or an unusable token key) must never block
  // the restaurant from removing the connection on our side.
  try {
    const { data } = await admin
      .from("tenant_mollie_accounts")
      .select("refresh_token_ciphertext, refresh_token_iv")
      .eq("tenant_id", actor.tenantId)
      .maybeSingle<{ refresh_token_ciphertext: string; refresh_token_iv: string }>();
    if (data) {
      const refreshToken = await decryptSecret(
        { ciphertext: data.refresh_token_ciphertext, iv: data.refresh_token_iv },
        `${actor.tenantId}:mollie:refresh`,
      );
      await revokeMollieToken(refreshToken, "refresh_token");
    }
  } catch {
    // ignored on purpose
  }

  const { error } = await admin
    .from("tenant_mollie_accounts")
    .delete()
    .eq("tenant_id", actor.tenantId);
  if (error) {
    return { error: "Die Verbindung konnte nicht getrennt werden. Bitte versuchen Sie es erneut." };
  }

  await recordMenuAdminAuditEvent(actor.supabase, {
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: "mollie_account.disconnected",
    targetType: "tenant_mollie_account",
    targetId: actor.tenantId,
  });

  revalidatePath("/account/payments");
  return { message: "PayPal (Mollie) wurde getrennt." };
}

/** Re-checks at Mollie whether PayPal is activated on the merchant's profile. */
export async function refreshMolliePaypalStatusAction(
  _prev: MollieActionFormState,
  _formData: FormData,
): Promise<MollieActionFormState> {
  const actor = await resolveConnectActor();
  if (!actor.ok) {
    return { error: actor.error };
  }

  const admin = createSupabaseAdminClient();
  try {
    const access = await getMollieAccessForTenant(admin, actor.tenantId);
    if (!access.profileId) {
      return { error: "Das Mollie-Profil ist unbekannt. Bitte neu verbinden." };
    }
    const enabled = await isMolliePaypalEnabled(access.accessToken, access.profileId);
    const { error } = await admin
      .from("tenant_mollie_accounts")
      .update({ paypal_enabled: enabled })
      .eq("tenant_id", actor.tenantId);
    if (error) {
      return { error: "Der Status konnte nicht gespeichert werden. Bitte erneut versuchen." };
    }
    revalidatePath("/account/payments");
    return {
      message: enabled
        ? "PayPal ist in Ihrem Mollie-Konto aktiv und im Checkout verfügbar."
        : "PayPal ist in Ihrem Mollie-Konto noch nicht aktiviert.",
    };
  } catch (error) {
    if (error instanceof MollieNotConnectedError) {
      return { error: "Die Mollie-Verbindung ist nicht aktiv. Bitte neu verbinden." };
    }
    console.error(
      "[mollie] paypal status refresh failed",
      error instanceof Error ? error.name : "error",
    );
    return {
      error: "Der Status konnte nicht geprüft werden. Bitte versuchen Sie es später erneut.",
    };
  }
}
