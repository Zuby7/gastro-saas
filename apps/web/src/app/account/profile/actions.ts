"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";
import { OpeningHoursSchema, ProfileSchema, WEEKDAYS } from "./schemas";

export interface ProfileFormState {
  error?: string;
  success?: string;
  fieldErrors?: Partial<
    Record<
      | "displayName"
      | "description"
      | "contactEmail"
      | "phone"
      | "timezone"
      | "brandColor"
      | "legalImprintText"
      | "legalPrivacyText",
      string
    >
  >;
}

export interface OpeningHoursFormState {
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<string, string>>;
}

/**
 * Ticket #11: saves the restaurant profile. Tenant context is resolved from
 * the caller's own membership row, never from client input, and the
 * `tenant.settings.write` permission is enforced server-side before any
 * write (RLS enforces it again independently).
 */
export async function saveProfileAction(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const parsed = ProfileSchema.safeParse({
    displayName: formData.get("displayName"),
    description: formData.get("description") ?? "",
    contactEmail: formData.get("contactEmail") ?? "",
    phone: formData.get("phone") ?? "",
    timezone: formData.get("timezone"),
    brandColor: formData.get("brandColor"),
    legalImprintText: formData.get("legalImprintText") ?? "",
    legalPrivacyText: formData.get("legalPrivacyText") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: ProfileFormState["fieldErrors"] = {};
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
      return { error: "Sie haben nicht die erforderliche Berechtigung, das Profil zu bearbeiten." };
    }
    throw error;
  }

  const { error: upsertError } = await supabase.from("restaurant_profiles").upsert(
    {
      tenant_id: membership.tenantId,
      display_name: parsed.data.displayName,
      description: parsed.data.description,
      contact_email: parsed.data.contactEmail || null,
      phone: parsed.data.phone || null,
      timezone: parsed.data.timezone,
      brand_color: parsed.data.brandColor,
      legal_imprint_text: parsed.data.legalImprintText,
      legal_privacy_text: parsed.data.legalPrivacyText,
      updated_by_user_id: user.id,
    },
    { onConflict: "tenant_id" },
  );

  if (upsertError) {
    return { error: "Das Profil konnte nicht gespeichert werden. Bitte versuchen Sie es erneut." };
  }

  await recordMenuAdminAuditEvent(supabase, {
    tenantId: membership.tenantId,
    actorUserId: user.id,
    action: "restaurant_profile.updated",
    targetType: "restaurant_profile",
    targetId: membership.tenantId,
  });

  revalidatePath("/account/profile");
  return { success: "Profil wurde gespeichert." };
}

/**
 * Ticket #11: saves all 7 opening-hours rows. The database's check
 * constraint (`opens_at < closes_at` unless `is_closed`) is the final
 * authority -- this action also validates client input shape/ordering first
 * so the error surfaced to the owner is clear, but a DB-level rejection
 * (e.g. a race with a concurrent edit) is still handled and reported.
 */
export async function saveOpeningHoursAction(
  _prevState: OpeningHoursFormState,
  formData: FormData,
): Promise<OpeningHoursFormState> {
  const rows = WEEKDAYS.map((weekday) => ({
    weekday,
    isClosed: formData.get(`closed-${weekday}`) === "on",
    opensAt: (formData.get(`opens-${weekday}`) as string | null) ?? "",
    closesAt: (formData.get(`closes-${weekday}`) as string | null) ?? "",
  }));

  const parsed = OpeningHoursSchema.safeParse({ rows });

  if (!parsed.success) {
    const fieldErrors: OpeningHoursFormState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const weekdayIndex = issue.path[1];
      const field = issue.path[2];
      if (typeof weekdayIndex === "number" && typeof field === "string") {
        fieldErrors[`${field}-${weekdayIndex}`] = issue.message;
      }
    }
    return {
      error: "Bitte korrigieren Sie die widersprüchlichen Öffnungszeiten.",
      fieldErrors,
    };
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
        error: "Sie haben nicht die erforderliche Berechtigung, die Öffnungszeiten zu bearbeiten.",
      };
    }
    throw error;
  }

  const payload = parsed.data.rows.map((row) => ({
    tenant_id: membership.tenantId,
    weekday: row.weekday,
    is_closed: row.isClosed,
    opens_at: row.isClosed ? null : row.opensAt,
    closes_at: row.isClosed ? null : row.closesAt,
  }));

  const { error: upsertError } = await supabase
    .from("opening_hours")
    .upsert(payload, { onConflict: "tenant_id,weekday" });

  if (upsertError) {
    const isContradictory =
      upsertError.message.toLowerCase().includes("opening_hours") || upsertError.code === "23514";
    return {
      error: isContradictory
        ? "Widersprüchliche Öffnungszeiten: Die Schließzeit muss nach der Öffnungszeit liegen."
        : "Die Öffnungszeiten konnten nicht gespeichert werden. Bitte versuchen Sie es erneut.",
    };
  }

  revalidatePath("/account/profile");
  return { success: "Öffnungszeiten wurden gespeichert." };
}
