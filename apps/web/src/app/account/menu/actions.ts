"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { getOrCreateDraftMenuVersionId } from "@/lib/menu/current-draft";
import { CategoryNameSchema, DishSchema } from "./schemas";

export interface MenuActionState {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string>;
}

export interface PublishCheckRow {
  severity: "blocker" | "warning";
  code: string;
  message: string;
}

export interface PublishState {
  error?: string;
  success?: string;
  checks?: PublishCheckRow[];
}

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

export async function createCategoryAction(
  _prevState: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const parsed = CategoryNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      error: "Bitte korrigieren Sie die markierten Felder.",
      fieldErrors: { name: parsed.error.issues[0]?.message ?? "Ungültig" },
    };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();

  try {
    await requireTenantPermission(supabase, tenantId, "menu.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, den Menüplan zu bearbeiten.",
      };
    }
    throw error;
  }

  const draftId = await getOrCreateDraftMenuVersionId(supabase, tenantId);

  const { data: maxSort } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("menu_version_id", draftId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  const { error: insertError } = await supabase.from("categories").insert({
    tenant_id: tenantId,
    menu_version_id: draftId,
    name: parsed.data.name,
    sort_order: (maxSort?.sort_order ?? 0) + 1,
  });

  if (insertError) {
    return { error: "Die Kategorie konnte nicht angelegt werden." };
  }

  revalidatePath("/account/menu");
  return { success: "Kategorie wurde angelegt." };
}

export async function renameCategoryAction(
  _prevState: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const categoryId = String(formData.get("categoryId") ?? "");
  const parsed = CategoryNameSchema.safeParse({ name: formData.get("name") });
  if (!categoryId || !parsed.success) {
    return { error: "Ungültige Eingabe." };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();

  try {
    await requireTenantPermission(supabase, tenantId, "menu.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, den Menüplan zu bearbeiten.",
      };
    }
    throw error;
  }

  const { error: updateError } = await supabase
    .from("categories")
    .update({ name: parsed.data.name })
    .eq("id", categoryId)
    .eq("tenant_id", tenantId);

  if (updateError) {
    return { error: "Die Kategorie konnte nicht umbenannt werden." };
  }

  revalidatePath("/account/menu");
  return { success: "Kategorie wurde umbenannt." };
}

export async function moveCategoryAction(
  _prevState: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const categoryId = String(formData.get("categoryId") ?? "");
  const direction = String(formData.get("direction") ?? "");
  if (!categoryId || (direction !== "up" && direction !== "down")) {
    return { error: "Ungültige Eingabe." };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();

  try {
    await requireTenantPermission(supabase, tenantId, "menu.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, den Menüplan zu bearbeiten.",
      };
    }
    throw error;
  }

  const { data: current } = await supabase
    .from("categories")
    .select("id, menu_version_id, sort_order")
    .eq("id", categoryId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ id: string; menu_version_id: string; sort_order: number }>();

  if (!current) {
    return { error: "Kategorie nicht gefunden." };
  }

  const { data: siblings } = await supabase
    .from("categories")
    .select("id, sort_order")
    .eq("menu_version_id", current.menu_version_id)
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .returns<{ id: string; sort_order: number }[]>();

  const ordered = siblings ?? [];
  const currentIndex = ordered.findIndex((row) => row.id === current.id);
  const neighborIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  const neighbor = neighborIndex >= 0 ? ordered[neighborIndex] : undefined;

  if (!neighbor) {
    return { success: "Bereits an dieser Position." };
  }

  // Swap via a temporary offset to avoid the (tenant_id, menu_version_id,
  // sort_order) uniqueness constraint colliding mid-swap.
  await supabase.from("categories").update({ sort_order: -1 }).eq("id", current.id);
  await supabase
    .from("categories")
    .update({ sort_order: current.sort_order })
    .eq("id", neighbor.id);
  await supabase
    .from("categories")
    .update({ sort_order: neighbor.sort_order })
    .eq("id", current.id);

  revalidatePath("/account/menu");
  return { success: "Reihenfolge aktualisiert." };
}

export async function archiveCategoryAction(
  _prevState: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const categoryId = String(formData.get("categoryId") ?? "");
  if (!categoryId) {
    return { error: "Ungültige Eingabe." };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();

  try {
    await requireTenantPermission(supabase, tenantId, "menu.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, den Menüplan zu bearbeiten.",
      };
    }
    throw error;
  }

  const { error: updateError } = await supabase
    .from("categories")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", categoryId)
    .eq("tenant_id", tenantId);

  if (updateError) {
    return { error: "Die Kategorie konnte nicht archiviert werden." };
  }

  revalidatePath("/account/menu");
  return { success: "Kategorie wurde archiviert." };
}

export async function createDishAction(
  _prevState: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const parsed = DishSchema.safeParse({
    categoryId: formData.get("categoryId"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    priceCents: formData.get("priceCents") ?? "",
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && !(field in fieldErrors)) {
        fieldErrors[field] = issue.message;
      }
    }
    return { error: "Bitte korrigieren Sie die markierten Felder.", fieldErrors };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();

  try {
    await requireTenantPermission(supabase, tenantId, "menu.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, den Menüplan zu bearbeiten.",
      };
    }
    throw error;
  }

  const draftId = await getOrCreateDraftMenuVersionId(supabase, tenantId);

  const { error: insertError } = await supabase.from("dishes").insert({
    tenant_id: tenantId,
    menu_version_id: draftId,
    category_id: parsed.data.categoryId,
    name: parsed.data.name,
    description: parsed.data.description,
    price_cents: parsed.data.priceCents ? Number(parsed.data.priceCents) : null,
  });

  if (insertError) {
    return { error: "Das Gericht konnte nicht angelegt werden." };
  }

  revalidatePath("/account/menu");
  return { success: "Gericht wurde angelegt." };
}

export async function archiveDishAction(
  _prevState: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const dishId = String(formData.get("dishId") ?? "");
  if (!dishId) {
    return { error: "Ungültige Eingabe." };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();

  try {
    await requireTenantPermission(supabase, tenantId, "menu.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, den Menüplan zu bearbeiten.",
      };
    }
    throw error;
  }

  const { error: updateError } = await supabase
    .from("dishes")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", dishId)
    .eq("tenant_id", tenantId);

  if (updateError) {
    return { error: "Das Gericht konnte nicht archiviert werden (ggf. bereits veröffentlicht)." };
  }

  revalidatePath("/account/menu");
  return { success: "Gericht wurde archiviert." };
}

export async function runPublishChecksAction(
  _prevState: PublishState,
  formData: FormData,
): Promise<PublishState> {
  const menuVersionId = String(formData.get("menuVersionId") ?? "");
  if (!menuVersionId) {
    return { error: "Ungültige Eingabe." };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();

  try {
    await requireTenantPermission(supabase, tenantId, "menu.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return { error: "Sie haben nicht die erforderliche Berechtigung, die Vorschau zu prüfen." };
    }
    throw error;
  }

  const { data, error } = await supabase.rpc("run_menu_publish_checks", {
    p_menu_version_id: menuVersionId,
  });

  if (error) {
    return { error: "Die Qualitätsprüfung konnte nicht ausgeführt werden." };
  }

  return { checks: (data ?? []) as PublishCheckRow[] };
}

export async function publishAction(
  _prevState: PublishState,
  formData: FormData,
): Promise<PublishState> {
  const menuVersionId = String(formData.get("menuVersionId") ?? "");
  if (!menuVersionId) {
    return { error: "Ungültige Eingabe." };
  }

  const { supabase, tenantId } = await requireMenuWriteContext();

  try {
    await requireTenantPermission(supabase, tenantId, "menu.publish");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error:
          "Sie haben nicht die erforderliche Berechtigung, die Speisekarte zu veröffentlichen.",
      };
    }
    throw error;
  }

  const { error } = await supabase.rpc("publish_menu_version", {
    p_menu_version_id: menuVersionId,
  });

  if (error) {
    return {
      error: error.message.toLowerCase().includes("blocker")
        ? "Die Speisekarte hat noch Blocker und kann nicht veröffentlicht werden."
        : "Die Speisekarte konnte nicht veröffentlicht werden.",
    };
  }

  revalidatePath("/account/menu");
  return { success: "Speisekarte wurde veröffentlicht." };
}
