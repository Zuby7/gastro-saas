import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { getOrCreateDraftMenuVersionId } from "@/lib/menu/current-draft";
import { CategoryForm } from "./category-form";
import { CategoryRow } from "./category-row";
import { DishForm } from "./dish-form";
import { DishRow } from "./dish-row";
import { PublishPanel } from "./publish-panel";

interface CategoryRecord {
  id: string;
  name: string;
  sort_order: number;
}

interface DishRecord {
  id: string;
  category_id: string;
  name: string;
  price_cents: number | null;
  allergen_reviewed: boolean;
}

/**
 * Ticket #12/#13/#14/#15 admin surface: categories/dishes editor for the
 * tenant's current draft menu version, plus the publish workflow. Gated on
 * `menu.write` server-side. Variant/option/allergen/additive/dietary-label
 * editing and image upload happen on the per-dish page
 * (`/account/menu/dishes/[dishId]`) linked from each dish row.
 */
export default async function MenuPage() {
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
            Sie haben nicht die erforderliche Berechtigung, um den Menüplan zu bearbeiten.
          </p>
          <Link
            href="/account"
            className="font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </main>
      );
    }
    throw error;
  }

  const draftId = await getOrCreateDraftMenuVersionId(supabase, membership.tenantId);

  const { data: categories } = await supabase
    .from("categories")
    .select("id, name, sort_order")
    .eq("menu_version_id", draftId)
    .is("archived_at", null)
    .order("sort_order")
    .returns<CategoryRecord[]>();

  const { data: dishes } = await supabase
    .from("dishes")
    .select("id, category_id, name, price_cents, allergen_reviewed")
    .eq("menu_version_id", draftId)
    .is("archived_at", null)
    .order("name")
    .returns<DishRecord[]>();

  const dishesByCategory = new Map<string, DishRecord[]>();
  for (const dish of dishes ?? []) {
    const bucket = dishesByCategory.get(dish.category_id) ?? [];
    bucket.push(dish);
    dishesByCategory.set(dish.category_id, bucket);
  }

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-semibold text-foreground">Speisekarte</h1>
              <span className="rounded-full border border-warning-500 bg-warning-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-warning-600">
                Entwurf
              </span>
            </div>
            <p className="mt-1 text-sm text-foreground-secondary" role="status">
              Dies ist der Entwurf -- Kunden sehen nur die zuletzt veröffentlichte Version.
            </p>
          </div>
          <Link
            href="/account"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </div>

        <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-0 p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Kategorien</h2>
          <CategoryForm />
        </section>

        {(categories ?? []).length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-neutral-0 p-4 text-foreground shadow-sm">
            Noch keine Kategorien angelegt.
          </p>
        ) : null}

        {(categories ?? []).map((category) => (
          <section
            key={category.id}
            className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-0 p-4 shadow-sm"
          >
            <CategoryRow id={category.id} name={category.name} />

            <ul className="flex flex-col gap-2">
              {(dishesByCategory.get(category.id) ?? []).map((dish) => (
                <DishRow
                  key={dish.id}
                  id={dish.id}
                  name={dish.name}
                  priceCents={dish.price_cents}
                  allergenReviewed={dish.allergen_reviewed}
                />
              ))}
            </ul>

            <DishForm categoryId={category.id} />
          </section>
        ))}

        <PublishPanel menuVersionId={draftId} />
      </div>
    </main>
  );
}
