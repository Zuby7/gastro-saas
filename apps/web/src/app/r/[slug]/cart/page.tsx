import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPrice } from "@/lib/public-menu/format";
import { getPublicMenu } from "@/lib/public-menu/fetch";
import { loadCartViewForDisplay } from "./actions";
import { CartLine } from "./cart-line";

interface CartPageProps {
  params: Promise<{ slug: string }>;
}

export default async function CartPage({ params }: CartPageProps) {
  const { slug } = await params;
  const menu = await getPublicMenu(slug);

  if (!menu) {
    notFound();
  }

  const cart = await loadCartViewForDisplay(slug);

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-neutral-50 px-5 py-10">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              Warenkorb
            </h1>
            <p className="mt-1 text-sm text-foreground-secondary">{menu.tenant.name}</p>
          </div>
          <Link
            href={`/r/${slug}`}
            className="shrink-0 rounded-full border border-neutral-300 bg-neutral-0 px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-clay-400 hover:text-clay-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-600"
          >
            Zurück zur Speisekarte
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
        {!cart || cart.items.length === 0 ? (
          <p className="rounded-md border border-neutral-300 bg-neutral-0 p-4 text-foreground">
            Ihr Warenkorb ist leer.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {cart.items.map((line) => (
                <CartLine
                  key={line.cartItemId}
                  line={line}
                  tenantSlug={slug}
                  currency={cart.currency}
                />
              ))}
            </ul>

            {cart.hasUnavailableItems ? (
              <p
                role="alert"
                className="rounded-md border border-danger-500 bg-danger-500/10 px-4 py-3 text-sm font-medium text-danger-600"
              >
                Ein oder mehrere Artikel sind nicht mehr verfügbar. Bitte entfernen Sie diese, um
                fortzufahren.
              </p>
            ) : null}

            <div className="flex items-center justify-between border-t border-neutral-300 pt-4">
              <span className="text-lg font-semibold text-foreground">Gesamtsumme</span>
              <span className="font-display text-2xl font-semibold text-clay-700">
                {formatPrice(cart.totalCents, cart.currency)}
              </span>
            </div>

            <button
              type="button"
              disabled={!cart.checkoutReady}
              title="Der Bestell-/Zahlungsvorgang wird in einem späteren Ticket ergänzt (Epic 7)."
              className="rounded-md bg-brand-600 px-4 py-3 font-medium text-neutral-0 transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Zur Kasse
            </button>
          </>
        )}
      </div>
    </main>
  );
}
