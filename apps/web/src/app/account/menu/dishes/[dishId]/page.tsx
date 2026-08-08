import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { DishBasicsForm } from "./dish-basics-form";
import { VariantsSection, type VariantRecord } from "./variants-section";
import { OptionGroupsSection, type OptionGroupRecord } from "./option-groups-section";
import { AssignableLookupSection, type LookupItem } from "./assignable-lookup-section";
import { ImageUploadForm } from "./image-upload-form";

interface DishPageProps {
  params: Promise<{ dishId: string }>;
}

interface DishRow {
  id: string;
  category_id: string;
  name: string;
  description: string;
  price_cents: number | null;
  allergen_reviewed: boolean;
  media_asset_id: string | null;
}

/**
 * Ticket #13/#14 admin surface: per-dish editor for variants, option
 * groups/extras, allergen/additive/dietary-label assignment, and image
 * upload. Gated on `menu.write` server-side.
 */
export default async function DishPage({ params }: DishPageProps) {
  const { dishId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    redirect("/account");
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "menu.write");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 bg-neutral-50 p-8">
          <p role="alert" className="text-foreground">
            Sie haben nicht die erforderliche Berechtigung, um dieses Gericht zu bearbeiten.
          </p>
          <Link
            href="/account/menu"
            className="font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </main>
      );
    }
    throw error;
  }

  const { data: dish } = await supabase
    .from("dishes")
    .select("id, category_id, name, description, price_cents, allergen_reviewed, media_asset_id")
    .eq("id", dishId)
    .eq("tenant_id", membership.tenantId)
    .maybeSingle<DishRow>();

  if (!dish) {
    notFound();
  }

  const [
    { data: variants },
    { data: optionGroups },
    { data: options },
    { data: groupAssignments },
    { data: allergens },
    { data: additives },
    { data: dietaryLabels },
    { data: allergenAssignments },
    { data: additiveAssignments },
    { data: dietaryLabelAssignments },
  ] = await Promise.all([
    supabase
      .from("dish_variants")
      .select("id, name, price_cents")
      .eq("dish_id", dishId)
      .order("sort_order")
      .returns<VariantRecord[]>(),
    supabase
      .from("option_groups")
      .select("id, name, min_selections, max_selections")
      .eq("tenant_id", membership.tenantId)
      .order("name")
      .returns<{ id: string; name: string; min_selections: number; max_selections: number }[]>(),
    supabase
      .from("options")
      .select("id, option_group_id, name, price_delta_cents")
      .eq("tenant_id", membership.tenantId)
      .order("sort_order")
      .returns<
        { id: string; option_group_id: string; name: string; price_delta_cents: number }[]
      >(),
    supabase
      .from("dish_option_group_assignments")
      .select("option_group_id")
      .eq("dish_id", dishId)
      .returns<{ option_group_id: string }[]>(),
    supabase
      .from("allergens")
      .select("id, name")
      .eq("tenant_id", membership.tenantId)
      .order("name")
      .returns<{ id: string; name: string }[]>(),
    supabase
      .from("additives")
      .select("id, name")
      .eq("tenant_id", membership.tenantId)
      .order("name")
      .returns<{ id: string; name: string }[]>(),
    supabase
      .from("dietary_labels")
      .select("id, name")
      .eq("tenant_id", membership.tenantId)
      .order("name")
      .returns<{ id: string; name: string }[]>(),
    supabase
      .from("dish_allergen_assignments")
      .select("allergen_id")
      .eq("dish_id", dishId)
      .returns<{ allergen_id: string }[]>(),
    supabase
      .from("dish_additive_assignments")
      .select("additive_id")
      .eq("dish_id", dishId)
      .returns<{ additive_id: string }[]>(),
    supabase
      .from("dish_dietary_label_assignments")
      .select("dietary_label_id")
      .eq("dish_id", dishId)
      .returns<{ dietary_label_id: string }[]>(),
  ]);

  const optionsByGroup = new Map<
    string,
    { id: string; name: string; price_delta_cents: number }[]
  >();
  for (const option of options ?? []) {
    const bucket = optionsByGroup.get(option.option_group_id) ?? [];
    bucket.push({ id: option.id, name: option.name, price_delta_cents: option.price_delta_cents });
    optionsByGroup.set(option.option_group_id, bucket);
  }

  const allOptionGroups: OptionGroupRecord[] = (optionGroups ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    min_selections: group.min_selections,
    max_selections: group.max_selections,
    options: optionsByGroup.get(group.id) ?? [],
  }));

  const assignedGroupIds = (groupAssignments ?? []).map((row) => row.option_group_id);
  const assignedAllergenIds = new Set((allergenAssignments ?? []).map((row) => row.allergen_id));
  const assignedAdditiveIds = new Set((additiveAssignments ?? []).map((row) => row.additive_id));
  const assignedDietaryLabelIds = new Set(
    (dietaryLabelAssignments ?? []).map((row) => row.dietary_label_id),
  );

  const allergenItems: LookupItem[] = (allergens ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    assigned: assignedAllergenIds.has(item.id),
  }));
  const additiveItems: LookupItem[] = (additives ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    assigned: assignedAdditiveIds.has(item.id),
  }));
  const dietaryLabelItems: LookupItem[] = (dietaryLabels ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    assigned: assignedDietaryLabelIds.has(item.id),
  }));

  let currentImageUrl: string | null = null;
  let currentAltText: string | null = null;
  if (dish.media_asset_id) {
    const { data: mediaAsset } = await supabase
      .from("media_assets")
      .select("storage_path, alt_text")
      .eq("id", dish.media_asset_id)
      .maybeSingle<{ storage_path: string; alt_text: string }>();

    if (mediaAsset) {
      currentAltText = mediaAsset.alt_text;
      const { data: signedUrl } = await supabase.storage
        .from("dish-media")
        .createSignedUrl(mediaAsset.storage_path, 60);
      currentImageUrl = signedUrl?.signedUrl ?? null;
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">{dish.name}</h1>
          <Link
            href="/account/menu"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück zur Speisekarte
          </Link>
        </div>

        <DishBasicsForm
          dishId={dish.id}
          name={dish.name}
          description={dish.description}
          priceCents={dish.price_cents}
          allergenReviewed={dish.allergen_reviewed}
        />

        <ImageUploadForm
          dishId={dish.id}
          currentImageUrl={currentImageUrl}
          currentAltText={currentAltText}
        />

        <VariantsSection dishId={dish.id} variants={variants ?? []} />

        <OptionGroupsSection
          dishId={dish.id}
          allOptionGroups={allOptionGroups}
          assignedGroupIds={assignedGroupIds}
        />

        <AssignableLookupSection
          dishId={dish.id}
          entity="allergen"
          heading="Allergene"
          newItemLabel="Neues Allergen"
          items={allergenItems}
        />
        <AssignableLookupSection
          dishId={dish.id}
          entity="additive"
          heading="Zusatzstoffe"
          newItemLabel="Neuer Zusatzstoff"
          items={additiveItems}
        />
        <AssignableLookupSection
          dishId={dish.id}
          entity="dietary_label"
          heading="Ernährungslabels"
          newItemLabel="Neues Label"
          items={dietaryLabelItems}
        />
      </div>
    </main>
  );
}
