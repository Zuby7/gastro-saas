import Link from "next/link";
import { notFound } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { resolveTenantIdBySlug } from "@/lib/cart/service";
import { recordDishViewsOnce, recordMenuViewOnce } from "@/lib/menu-view/service";
import { getPublicMenu } from "@/lib/public-menu/fetch";
import { loadCartViewForDisplay } from "./cart/actions";
import { CategoryNav } from "./category-nav";
import { CookieConsentBanner, CookieSettingsLink } from "./cookie-consent-banner";
import { DishCard } from "./dish-card";

interface PublicMenuPageProps {
  params: Promise<{ slug: string }>;
}

export default async function PublicMenuPage({ params }: PublicMenuPageProps) {
  const { slug } = await params;
  const menu = await getPublicMenu(slug);

  if (!menu) {
    notFound();
  }

  const cart = await loadCartViewForDisplay(slug);

  // Ticket #67: record a rate-limited/deduplicated menu_viewed event for
  // this tenant+session+day, resolving tenant_id server-side from the slug
  // (never trusting a client-supplied value, per
  // docs/security/tenant-isolation.md Layer 0). Best-effort -- never throws,
  // never blocks rendering on a real failure.
  const tenantId = await resolveTenantIdBySlug(slug);
  if (tenantId) {
    await recordMenuViewOnce(slug, tenantId);

    // Ticket #120 part B: record a rate-limited/deduplicated dish_view event
    // for every dish shown on this render, resolving both tenant_id and dish
    // ids server-side from the already-fetched (never client-supplied) menu.
    // A single batched RPC call (not one call per dish -- see
    // `recordDishViewsOnce`'s own comment, PR #136 Opus finding: one call
    // per dish previously took one advisory lock per dish, serializing in
    // Postgres and blocking TTFB on this SEO-critical page).
    const dishIds = menu.categories.flatMap((category) => category.dishes.map((dish) => dish.id));
    await recordDishViewsOnce(slug, tenantId, dishIds);
  }

  return (
    <main className="min-h-screen bg-surface-secondary">
      {/*
        Hero (design pass v2, see `packages/ui/src/tokens.ts`'s header
        comment for context and the approved mockup this replicates): a
        warm, dark diagonal gradient replacing the old flat
        `bg-surface-secondary` header band. The two gradient stops and the
        `gold-300` label/badge color are checked against
        `public-menu-design.a11y.test.ts` (contrast measured against
        `espresso-800`, the LIGHTER of the two stops -- the worst case for
        light/white text, since a lighter background gives it less
        contrast).
      */}
      <header className="bg-gradient-to-br from-espresso-900 to-espresso-800 px-5 pt-8 pb-6 sm:px-12 sm:pt-14 sm:pb-11">
        <div className="mx-auto flex max-w-5xl flex-col gap-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="max-w-xl">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-[2.5rem]">
              {menu.tenant.name}
            </h1>
            {menu.tenant.description ? (
              <p className="mt-3 max-w-[32rem] leading-relaxed text-white/80">
                {menu.tenant.description}
              </p>
            ) : null}
          </div>

          <Link
            href={`/r/${slug}/cart`}
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-white/25 bg-white/12 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300"
          >
            <ShoppingBag className="h-4 w-4" aria-hidden="true" />
            <span>Warenkorb</span>
            {cart && cart.itemCount > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-300 px-1.5 text-xs font-semibold text-neutral-900">
                {cart.itemCount}
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      {menu.categories.length > 0 ? (
        <CategoryNav categories={menu.categories.map(({ id, name }) => ({ id, name }))} />
      ) : null}

      <div className="mx-auto flex max-w-5xl flex-col gap-12 px-5 py-10 sm:px-8">
        {menu.categories.length === 0 ? (
          <p className="rounded-md border border-neutral-300 bg-surface p-4 text-foreground">
            Diese Speisekarte ist aktuell leer.
          </p>
        ) : null}

        {menu.categories.map((category) => (
          <section key={category.id} id={`category-${category.id}`} className="scroll-mt-20">
            <h2 className="font-display text-[1.375rem] font-semibold tracking-tight text-foreground">
              {category.name}
            </h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {category.dishes.map((dish) => (
                <DishCard key={dish.id} dish={dish} tenantSlug={slug} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/*
        Ticket #41/#146: footer links to the tenant-maintained
        Impressum/Datenschutz/AGB pages.
      */}
      <footer className="border-t border-neutral-200 px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-4 text-sm">
          <Link
            href={`/r/${slug}/impressum`}
            className="font-medium text-link-foreground underline hover:text-brand-700"
          >
            Impressum
          </Link>
          <Link
            href={`/r/${slug}/datenschutz`}
            className="font-medium text-link-foreground underline hover:text-brand-700"
          >
            Datenschutz
          </Link>
          <Link
            href={`/r/${slug}/agb`}
            className="font-medium text-link-foreground underline hover:text-brand-700"
          >
            AGB
          </Link>
          <CookieSettingsLink />
        </div>
      </footer>

      <CookieConsentBanner tenantSlug={slug} />
    </main>
  );
}
