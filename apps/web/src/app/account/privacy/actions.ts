"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { RetentionSettingsSchema, DeletionRequestSchema } from "./schemas";

export interface RetentionSettingsFormState {
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<"analyticsEventsRetentionDays", string>>;
}

export interface DeletionRequestFormState {
  error?: string;
  success?: string;
}

/**
 * Ticket #36: saves the tenant's configurable analytics_events retention
 * period. Gated on `tenant.settings.write` -- audit_logs has no configurable
 * retention (it is append-only/immutable by design, ticket #6) and is not
 * touched by this action.
 */
export async function saveRetentionSettingsAction(
  _prevState: RetentionSettingsFormState,
  formData: FormData,
): Promise<RetentionSettingsFormState> {
  const parsed = RetentionSettingsSchema.safeParse({
    analyticsEventsRetentionDays: formData.get("analyticsEventsRetentionDays"),
  });

  if (!parsed.success) {
    const fieldErrors: RetentionSettingsFormState["fieldErrors"] = {};
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

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return { error: "Sie sind noch keinem Restaurant zugeordnet." };
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "tenant.settings.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error:
          "Sie haben nicht die erforderliche Berechtigung, die Aufbewahrungsfristen zu bearbeiten.",
      };
    }
    throw error;
  }

  const { error: upsertError } = await supabase.from("privacy_retention_settings").upsert(
    {
      tenant_id: membership.tenantId,
      analytics_events_retention_days: parsed.data.analyticsEventsRetentionDays,
      updated_by_user_id: user.id,
    },
    { onConflict: "tenant_id" },
  );

  if (upsertError) {
    return {
      error:
        "Die Aufbewahrungsfrist konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
    };
  }

  revalidatePath("/account/privacy");
  return { success: "Aufbewahrungsfrist wurde gespeichert." };
}

/**
 * Ticket #36 (risk:privacy): Owner-only deletion request. Gated on the new
 * `tenant.data.delete` permission -- two enforcement layers: this
 * `requireTenantPermission` call AND `process_tenant_data_deletion_request()`'s
 * own internal re-check. The actual retention-respecting logic (never
 * hard-deleting orders/payments, anonymizing only past the documented legal
 * retention period, purging analytics_events in full) lives entirely in that
 * RPC -- see its migration comment.
 */
export async function requestTenantDataDeletionAction(
  _prevState: DeletionRequestFormState,
  formData: FormData,
): Promise<DeletionRequestFormState> {
  const parsed = DeletionRequestSchema.safeParse({
    reason: formData.get("reason") ?? "",
  });

  if (!parsed.success) {
    return { error: "Bitte korrigieren Sie die Begruendung (max. 500 Zeichen)." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return { error: "Sie sind noch keinem Restaurant zugeordnet." };
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "tenant.data.delete");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Nur der Owner kann einen Loeschantrag stellen.",
      };
    }
    throw error;
  }

  const { error: rpcError } = await supabase.rpc("process_tenant_data_deletion_request", {
    p_tenant_id: membership.tenantId,
    p_reason: parsed.data.reason || null,
  });

  if (rpcError) {
    return {
      error: "Der Loeschantrag konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.",
    };
  }

  revalidatePath("/account/privacy");
  return {
    success:
      "Loeschantrag wurde verarbeitet: Bestell-/Zahlungsdaten innerhalb der gesetzlichen Aufbewahrungsfrist bleiben erhalten, Kundendaten aelterer Bestellungen wurden anonymisiert, Analytics-Events wurden geloescht.",
  };
}
