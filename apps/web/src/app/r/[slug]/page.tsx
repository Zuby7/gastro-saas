import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPrice } from "@/lib/public-menu/format";
import { getPublicMenu } from "@/lib/public-menu/fetch";
import { loadCartViewForDisplay } from "./cart/actions";
import { DishDetail } from "./dish-detail";

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

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-neutral-50 px-5 py-12">
        <div className="mx-auto flex max-w-4xl items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {menu.tenant.name}
            </h1>
            {menu.tenant.description ? (
              <p className="mt-4 max-w-2xl text-foreground-secondary">{menu.tenant.description}</p>
            ) : null}
          </div>
          <Link
            href={`/r/${slug}/cart`}
            className="shrink-0 rounded-full border border-neutral-300 bg-neutral-0 px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-ember-400 hover:text-ember-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-600"
          >
            Warenkorb{cart && cart.itemCount > 0 ? ` (${cart.itemCount})` : ""}
          </Link>
        </div>
      </header>

      {menu.categories.length > 0 ? (
        <nav
          aria-label="Kategorien"
          className="sticky top-0 z-10 border-b border-neutral-200 bg-neutral-0/95 px-4 py-3 backdrop-blur"
        >
          <div className="mx-auto flex max-w-4xl gap-2 overflow-x-auto">
            {menu.categories.map((category) => (
              <a
                key={category.id}
                href={`#category-${category.id}`}
                className="shrink-0 rounded-full border border-neutral-300 px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-ember-400 hover:text-ember-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-600"
              >
                {category.name}
              </a>
            ))}
          </div>
        </nav>
      ) : null}

      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-5 py-8">
        {menu.categories.length === 0 ? (
          <p className="rounded-md border border-neutral-300 bg-neutral-0 p-4 text-foreground">
            Diese Speisekarte ist aktuell leer.
          </p>
        ) : null}

        {menu.categories.map((category) => (
          <section key={category.id} id={`category-${category.id}`} className="scroll-mt-20">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
              {category.name}
            </h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {category.dishes.map((dish) => (
                <article
                  key={dish.id}
                  className="rounded-lg border border-neutral-200 bg-neutral-0 p-4 shadow-sm"
                >
                  {dish.image ? (
                    <div className="mb-3 aspect-[4/3] overflow-hidden rounded-md bg-neutral-100">
                      <img
                        src={`/media/${dish.image.path}`}
                        alt={dish.image.alt}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ) : null}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{dish.name}</h3>
                      {dish.description ? (
                        <p className="mt-1 text-sm text-foreground-secondary">{dish.description}</p>
                      ) : null}
                    </div>
                    <p className="font-display font-semibold text-ember-700">
                      {formatPrice(dish.priceCents, dish.currency)}
                    </p>
                  </div>

                  {dish.labels.length > 0 ? (
                    <ul className="mt-3 flex flex-wrap gap-2" aria-label="Labels">
                      {dish.labels.map((label) => (
                        <li
                          key={label}
                          className="rounded-full border border-neutral-300 px-2 py-1 text-xs text-foreground"
                        >
                          {label}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <p className="mt-3 text-xs text-foreground-secondary">{dish.allergenNotice}</p>

                  {dish.soldOut ? (
                    <p className="mt-3 rounded-md border border-danger-500 bg-danger-500/10 px-2 py-1 text-sm font-medium text-danger-600">
                      Ausverkauft
                    </p>
                  ) : (
                    <DishDetail dish={dish} tenantSlug={slug} />
                  )}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
