import type { SupabaseClient } from "@supabase/supabase-js";

export type DishVersionContext =
  { kind: "draft" } | { kind: "frozen"; draftDishId: string | null; draftExists: boolean };

/**
 * `publish_menu_version` freezes the published version and clones a fresh
 * draft with new row ids, so a dish id taken from an old link/bookmark may
 * belong to a published or archived version whose rows cannot be edited.
 *
 * This resolves where such a dish lives now: `draft` when its version is the
 * editable draft, otherwise `frozen` plus the id of the matching dish in the
 * tenant's current draft (matched by category name and dish name, both
 * non-archived), or `null` when it cannot be resolved. Plain user-session
 * reads, always filtered by `tenantId`; RLS stays the enforcement layer.
 */
export async function resolveDishVersionContext(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    menuVersionId: string;
    categoryId: string;
    dishName: string;
  },
): Promise<DishVersionContext> {
  const { data: version } = await supabase
    .from("menu_versions")
    .select("id, status")
    .eq("id", input.menuVersionId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle<{ id: string; status: string }>();

  // A dish whose version cannot be read stays on the existing path (the page
  // already 404s for rows it cannot see); only a known non-draft is frozen.
  if (!version || version.status === "draft") {
    return { kind: "draft" };
  }

  const { data: draft } = await supabase
    .from("menu_versions")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("status", "draft")
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!draft) {
    return { kind: "frozen", draftDishId: null, draftExists: false };
  }

  const { data: category } = await supabase
    .from("categories")
    .select("name")
    .eq("id", input.categoryId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle<{ name: string }>();

  if (!category) {
    return { kind: "frozen", draftDishId: null, draftExists: true };
  }

  const { data: draftCategory } = await supabase
    .from("categories")
    .select("id")
    .eq("menu_version_id", draft.id)
    .eq("tenant_id", input.tenantId)
    .eq("name", category.name)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!draftCategory) {
    return { kind: "frozen", draftDishId: null, draftExists: true };
  }

  const { data: draftDish } = await supabase
    .from("dishes")
    .select("id")
    .eq("menu_version_id", draft.id)
    .eq("tenant_id", input.tenantId)
    .eq("category_id", draftCategory.id)
    .eq("name", input.dishName)
    .is("archived_at", null)
    .limit(1)
    .maybeSingle<{ id: string }>();

  return { kind: "frozen", draftDishId: draftDish?.id ?? null, draftExists: true };
}
