"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";
import {
  ALLOWED_IMAGE_TYPES,
  AssignmentEntitySchema,
  AvailabilitySchema,
  DishBasicsSchema,
  IMAGE_EXTENSION_BY_MIME,
  LookupNameSchema,
  MAX_IMAGE_SIZE_BYTES,
  OptionGroupSchema,
  OptionSchema,
  VariantSchema,
  type AssignmentEntity,
} from "./schemas";

export interface DishActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
}

const ASSIGNMENT_CONFIG: Record<
  AssignmentEntity,
  { lookupTable: string; assignmentTable: string; foreignKeyColumn: string }
> = {
  allergen: {
    lookupTable: "allergens",
    assignmentTable: "dish_allergen_assignments",
    foreignKeyColumn: "allergen_id",
  },
  additive: {
    lookupTable: "additives",
    assignmentTable: "dish_additive_assignments",
    foreignKeyColumn: "additive_id",
  },
  dietary_label: {
    lookupTable: "dietary_labels",
    assignmentTable: "dish_dietary_label_assignments",
    foreignKeyColumn: "dietary_label_id",
  },
};

async function requireMenuWriteContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    throw new Error("Sie sind noch keinem Restaurant zugeordnet.");
  }

  return { supabase, user, tenantId: membership.tenantId };
}

async function ensurePermission(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
): Promise<DishActionState | null> {
  try {
    await requireTenantPermission(supabase, tenantId, "menu.write");
    return null;
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, den Menüplan zu bearbeiten.",
      };
    }
    throw error;
  }
}

async function ensureAvailabilityPermission(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
): Promise<DishActionState | null> {
  try {
    await requireTenantPermission(supabase, tenantId, "menu.availability.manage");
    return null;
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, die Verfügbarkeit zu ändern.",
      };
    }
    throw error;
  }
}

function revalidateDish(dishId: string) {
  revalidatePath(`/account/menu/dishes/${dishId}`);
  revalidatePath("/account/menu");
}

/**
 * Ticket #29: parses the shared availability form fields (isAvailable +
 * optional availableAgainAt datetime-local string) once for all three
 * toggle actions below. Returns null on a validation failure.
 */
function parseAvailabilityInput(
  formData: FormData,
): { isAvailable: boolean; availableAgainAt: string | null } | null {
  const parsed = AvailabilitySchema.safeParse({
    isAvailable: formData.get("isAvailable"),
    availableAgainAt: formData.get("availableAgainAt") ?? "",
  });

  if (!parsed.success) {
    return null;
  }

  const availableAgainAt = parsed.data.availableAgainAt
    ? new Date(parsed.data.availableAgainAt).toISOString()
    : null;

  return { isAvailable: parsed.data.isAvailable, availableAgainAt };
}

export async function updateDishBasicsAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const parsed = DishBasicsSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    priceCents: formData.get("priceCents") ?? "",
  });

  if (!dishId || !parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.success ? [] : parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string") fieldErrors[field] = issue.message;
    }
    return { error: "Bitte korrigieren Sie die markierten Felder.", fieldErrors };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();
  const denied = await ensurePermission(supabase, tenantId);
  if (denied) return denied;

  const { data: updatedRows, error } = await supabase
    .from("dishes")
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      price_cents: parsed.data.priceCents ? Number(parsed.data.priceCents) : null,
    })
    .eq("id", dishId)
    .eq("tenant_id", tenantId)
    .select("id");

  if (error || !updatedRows || updatedRows.length === 0) {
    return { error: "Das Gericht konnte nicht gespeichert werden (ggf. bereits veröffentlicht)." };
  }

  revalidateDish(dishId);
  return { success: "Gericht wurde gespeichert." };
}

export async function setAllergenReviewedAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const reviewed = formData.get("reviewed") === "true";
  if (!dishId) return { error: "Ungültige Eingabe." };

  const { supabase, tenantId } = await requireMenuWriteContext();
  const denied = await ensurePermission(supabase, tenantId);
  if (denied) return denied;

  const { data: updatedRows, error } = await supabase
    .from("dishes")
    .update({ allergen_reviewed: reviewed })
    .eq("id", dishId)
    .eq("tenant_id", tenantId)
    .select("id");

  if (error || !updatedRows || updatedRows.length === 0) {
    return { error: "Der Allergen-Prüfstatus konnte nicht gespeichert werden." };
  }

  revalidateDish(dishId);
  return { success: reviewed ? "Als geprüft markiert." : "Prüfstatus zurückgesetzt." };
}

/**
 * Ticket #29 ("Ausverkauft-Steuerung"): marks a dish itself sold out /
 * available again, with an optional scheduled re-availability timestamp.
 * Gated on `menu.availability.manage` (Owner/Manager/Kitchen/Service), NOT
 * `menu.write` -- Kitchen/Service can toggle availability without full menu
 * edit rights. Goes through `set_dish_availability()` (SECURITY DEFINER,
 * re-checks the permission itself server-side, and is the only path allowed
 * to write these two columns without also requiring `menu.write` -- see
 * that migration's header comment) rather than a raw table `.update()`.
 */
export async function setDishAvailabilityAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const input = parseAvailabilityInput(formData);
  if (!dishId || !input) return { error: "Ungültige Eingabe." };

  const { supabase, tenantId, user } = await requireMenuWriteContext();
  const denied = await ensureAvailabilityPermission(supabase, tenantId);
  if (denied) return denied;

  const { error } = await supabase.rpc("set_dish_availability", {
    p_dish_id: dishId,
    p_tenant_id: tenantId,
    p_is_available: input.isAvailable,
    p_available_again_at: input.availableAgainAt,
  });

  if (error) {
    return { error: "Die Verfügbarkeit konnte nicht gespeichert werden." };
  }

  await recordMenuAdminAuditEvent(supabase, {
    tenantId,
    actorUserId: user?.id ?? null,
    action: input.isAvailable ? "dish.marked_available" : "dish.marked_sold_out",
    targetType: "dish",
    targetId: dishId,
    metadata: { isAvailable: input.isAvailable, availableAgainAt: input.availableAgainAt },
  });

  revalidateDish(dishId);
  return { success: input.isAvailable ? "Als verfügbar markiert." : "Als ausverkauft markiert." };
}

/** Ticket #29: same as `setDishAvailabilityAction`, for one variant. */
export async function setDishVariantAvailabilityAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const variantId = String(formData.get("variantId") ?? "");
  const input = parseAvailabilityInput(formData);
  if (!dishId || !variantId || !input) return { error: "Ungültige Eingabe." };

  const { supabase, tenantId, user } = await requireMenuWriteContext();
  const denied = await ensureAvailabilityPermission(supabase, tenantId);
  if (denied) return denied;

  const { error } = await supabase.rpc("set_dish_variant_availability", {
    p_variant_id: variantId,
    p_tenant_id: tenantId,
    p_is_available: input.isAvailable,
    p_available_again_at: input.availableAgainAt,
  });

  if (error) {
    return { error: "Die Verfügbarkeit konnte nicht gespeichert werden." };
  }

  await recordMenuAdminAuditEvent(supabase, {
    tenantId,
    actorUserId: user?.id ?? null,
    action: input.isAvailable ? "dish_variant.marked_available" : "dish_variant.marked_sold_out",
    targetType: "dish_variant",
    targetId: variantId,
    metadata: { isAvailable: input.isAvailable, availableAgainAt: input.availableAgainAt },
  });

  revalidateDish(dishId);
  return { success: input.isAvailable ? "Als verfügbar markiert." : "Als ausverkauft markiert." };
}

/** Ticket #29: same as `setDishAvailabilityAction`, for one option. */
export async function setOptionAvailabilityAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const optionId = String(formData.get("optionId") ?? "");
  const input = parseAvailabilityInput(formData);
  if (!dishId || !optionId || !input) return { error: "Ungültige Eingabe." };

  const { supabase, tenantId, user } = await requireMenuWriteContext();
  const denied = await ensureAvailabilityPermission(supabase, tenantId);
  if (denied) return denied;

  const { error } = await supabase.rpc("set_option_availability", {
    p_option_id: optionId,
    p_tenant_id: tenantId,
    p_is_available: input.isAvailable,
    p_available_again_at: input.availableAgainAt,
  });

  if (error) {
    return { error: "Die Verfügbarkeit konnte nicht gespeichert werden." };
  }

  await recordMenuAdminAuditEvent(supabase, {
    tenantId,
    actorUserId: user?.id ?? null,
    action: input.isAvailable ? "option.marked_available" : "option.marked_sold_out",
    targetType: "option",
    targetId: optionId,
    metadata: { isAvailable: input.isAvailable, availableAgainAt: input.availableAgainAt },
  });

  revalidateDish(dishId);
  return { success: input.isAvailable ? "Als verfügbar markiert." : "Als ausverkauft markiert." };
}

export async function createVariantAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const parsed = VariantSchema.safeParse({
    name: formData.get("name"),
    priceCents: formData.get("priceCents"),
  });

  if (!dishId || !parsed.success) {
    return { error: "Bitte korrigieren Sie die markierten Felder." };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();
  const denied = await ensurePermission(supabase, tenantId);
  if (denied) return denied;

  const { error } = await supabase.from("dish_variants").insert({
    tenant_id: tenantId,
    dish_id: dishId,
    name: parsed.data.name,
    price_cents: Number(parsed.data.priceCents),
  });

  if (error) {
    return { error: "Die Variante konnte nicht angelegt werden." };
  }

  revalidateDish(dishId);
  return { success: "Variante wurde angelegt." };
}

export async function deleteVariantAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const variantId = String(formData.get("variantId") ?? "");
  if (!dishId || !variantId) return { error: "Ungültige Eingabe." };

  const { supabase, tenantId } = await requireMenuWriteContext();
  const denied = await ensurePermission(supabase, tenantId);
  if (denied) return denied;

  const { error } = await supabase
    .from("dish_variants")
    .delete()
    .eq("id", variantId)
    .eq("tenant_id", tenantId);

  if (error) {
    return { error: "Die Variante konnte nicht entfernt werden (ggf. bereits veröffentlicht)." };
  }

  revalidateDish(dishId);
  return { success: "Variante wurde entfernt." };
}

export async function createOptionGroupAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const parsed = OptionGroupSchema.safeParse({
    name: formData.get("name"),
    minSelections: formData.get("minSelections") ?? "0",
    maxSelections: formData.get("maxSelections") ?? "1",
  });

  if (!dishId || !parsed.success) {
    return { error: parsed.success ? "Ungültige Eingabe." : parsed.error.issues[0]?.message };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();
  const denied = await ensurePermission(supabase, tenantId);
  if (denied) return denied;

  const { error } = await supabase.from("option_groups").insert({
    tenant_id: tenantId,
    name: parsed.data.name,
    min_selections: parsed.data.minSelections,
    max_selections: parsed.data.maxSelections,
  });

  if (error) {
    return {
      error:
        "Die Optionsgruppe konnte nicht angelegt werden (Minimum darf das Maximum nicht überschreiten).",
    };
  }

  revalidateDish(dishId);
  return { success: "Optionsgruppe wurde angelegt." };
}

export async function createOptionAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const parsed = OptionSchema.safeParse({
    optionGroupId: formData.get("optionGroupId"),
    name: formData.get("name"),
    priceDeltaCents: formData.get("priceDeltaCents") ?? "0",
  });

  if (!dishId || !parsed.success) {
    return { error: "Bitte korrigieren Sie die markierten Felder." };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();
  const denied = await ensurePermission(supabase, tenantId);
  if (denied) return denied;

  const { error } = await supabase.from("options").insert({
    tenant_id: tenantId,
    option_group_id: parsed.data.optionGroupId,
    name: parsed.data.name,
    price_delta_cents: parsed.data.priceDeltaCents,
  });

  if (error) {
    return { error: "Die Option konnte nicht angelegt werden." };
  }

  revalidateDish(dishId);
  return { success: "Option wurde angelegt." };
}

export async function assignOptionGroupAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const optionGroupId = String(formData.get("optionGroupId") ?? "");
  if (!dishId || !optionGroupId) return { error: "Ungültige Eingabe." };

  const { supabase, tenantId } = await requireMenuWriteContext();
  const denied = await ensurePermission(supabase, tenantId);
  if (denied) return denied;

  const { error } = await supabase.from("dish_option_group_assignments").insert({
    tenant_id: tenantId,
    dish_id: dishId,
    option_group_id: optionGroupId,
  });

  if (error) {
    return { error: "Die Optionsgruppe konnte nicht zugewiesen werden." };
  }

  revalidateDish(dishId);
  return { success: "Optionsgruppe wurde zugewiesen." };
}

export async function unassignOptionGroupAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const optionGroupId = String(formData.get("optionGroupId") ?? "");
  if (!dishId || !optionGroupId) return { error: "Ungültige Eingabe." };

  const { supabase, tenantId } = await requireMenuWriteContext();
  const denied = await ensurePermission(supabase, tenantId);
  if (denied) return denied;

  const { error } = await supabase
    .from("dish_option_group_assignments")
    .delete()
    .eq("dish_id", dishId)
    .eq("option_group_id", optionGroupId)
    .eq("tenant_id", tenantId);

  if (error) {
    return {
      error: "Die Optionsgruppe konnte nicht entfernt werden (ggf. bereits veröffentlicht).",
    };
  }

  revalidateDish(dishId);
  return { success: "Optionsgruppe wurde entfernt." };
}

export async function createLookupValueAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const entityParsed = AssignmentEntitySchema.safeParse(formData.get("entity"));
  const nameParsed = LookupNameSchema.safeParse({ name: formData.get("name") });

  if (!dishId || !entityParsed.success || !nameParsed.success) {
    return { error: "Bitte korrigieren Sie die markierten Felder." };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();
  const denied = await ensurePermission(supabase, tenantId);
  if (denied) return denied;

  const { lookupTable } = ASSIGNMENT_CONFIG[entityParsed.data];
  const { error } = await supabase.from(lookupTable).insert({
    tenant_id: tenantId,
    name: nameParsed.data.name,
  });

  if (error) {
    return { error: "Der Eintrag konnte nicht angelegt werden (ggf. bereits vorhanden)." };
  }

  revalidateDish(dishId);
  return { success: "Eintrag wurde angelegt." };
}

export async function toggleAssignmentAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const entityParsed = AssignmentEntitySchema.safeParse(formData.get("entity"));
  const shouldAssign = formData.get("assign") === "true";

  if (!dishId || !itemId || !entityParsed.success) {
    return { error: "Ungültige Eingabe." };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();
  const denied = await ensurePermission(supabase, tenantId);
  if (denied) return denied;

  const { assignmentTable, foreignKeyColumn } = ASSIGNMENT_CONFIG[entityParsed.data];

  if (shouldAssign) {
    const { error } = await supabase.from(assignmentTable).insert({
      tenant_id: tenantId,
      dish_id: dishId,
      [foreignKeyColumn]: itemId,
    });
    if (error) {
      return { error: "Die Zuordnung konnte nicht gespeichert werden." };
    }
  } else {
    const { error } = await supabase
      .from(assignmentTable)
      .delete()
      .eq("dish_id", dishId)
      .eq(foreignKeyColumn, itemId)
      .eq("tenant_id", tenantId);
    if (error) {
      return { error: "Die Zuordnung konnte nicht entfernt werden (ggf. bereits veröffentlicht)." };
    }
  }

  revalidateDish(dishId);
  return { success: "Zuordnung wurde gespeichert." };
}

/**
 * Ticket #12's image upload requirement, minimal scope: validates file
 * type/size server-side (matching the `media_assets` check constraints and
 * the `dish-media` storage bucket's own limits -- defense in depth, not
 * trusting either layer alone), uploads to the tenant-scoped storage path,
 * inserts the `media_assets` row, and attaches it to the dish.
 *
 * Deliberately NOT re-encoding/re-compressing the uploaded image server-side
 * (out of scope for this pass -- see the follow-up GitHub issue filed for
 * this, referenced in the PR description). Re-encoding matters for
 * stripping EXIF/GPS metadata and normalizing format/size; until it ships,
 * uploaded images are stored as-is (subject to the type/size checks above).
 */
export async function uploadDishImageAction(
  _prevState: DishActionState,
  formData: FormData,
): Promise<DishActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  const altText = String(formData.get("altText") ?? "").trim();
  const file = formData.get("file");

  if (!dishId || !altText) {
    return { error: "Bitte geben Sie einen Alt-Text an und wählen Sie eine Datei." };
  }

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Bitte wählen Sie eine Bilddatei aus." };
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return { error: "Nur JPEG-, PNG- oder WebP-Bilder sind erlaubt." };
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    return { error: "Das Bild darf höchstens 5 MB groß sein." };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();
  const denied = await ensurePermission(supabase, tenantId);
  if (denied) return denied;

  const extension = IMAGE_EXTENSION_BY_MIME[file.type as (typeof ALLOWED_IMAGE_TYPES)[number]];
  const storagePath = `${tenantId}/${randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("dish-media")
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    return { error: "Das Bild konnte nicht hochgeladen werden." };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: mediaAsset, error: insertError } = await supabase
    .from("media_assets")
    .insert({
      tenant_id: tenantId,
      storage_path: storagePath,
      content_type: file.type,
      size_bytes: file.size,
      alt_text: altText,
      created_by_user_id: user?.id ?? null,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !mediaAsset) {
    await supabase.storage.from("dish-media").remove([storagePath]);
    return { error: "Die Bildmetadaten konnten nicht gespeichert werden." };
  }

  const { data: updatedRows, error: dishUpdateError } = await supabase
    .from("dishes")
    .update({ media_asset_id: mediaAsset.id })
    .eq("id", dishId)
    .eq("tenant_id", tenantId)
    .select("id");

  if (dishUpdateError || !updatedRows || updatedRows.length === 0) {
    // The storage object + media_assets row were already created above --
    // clean both up rather than leaving them orphaned (Opus cycle-3 finding:
    // this was the one error branch in this action that didn't already
    // clean up after itself, unlike the insertError branch just above).
    await supabase.from("media_assets").delete().eq("id", mediaAsset.id);
    await supabase.storage.from("dish-media").remove([storagePath]);
    return {
      error: "Das Bild konnte dem Gericht nicht zugewiesen werden (ggf. bereits veröffentlicht).",
    };
  }

  await recordMenuAdminAuditEvent(supabase, {
    tenantId,
    actorUserId: user?.id ?? null,
    action: "dish.image_uploaded",
    targetType: "dish",
    targetId: dishId,
    metadata: { mediaAssetId: mediaAsset.id, contentType: file.type, sizeBytes: file.size },
  });

  revalidateDish(dishId);
  return { success: "Bild wurde hochgeladen." };
}
