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
      {/*
        Quieter version of the public menu's hero gradient (design pass v2,
        see `packages/ui/src/tokens.ts`'s header comment) -- kept modest
        since the cart/checkout/order-status flow is not this pass's
        "moment" (the menu hero is). Only the color language and header
        chrome are unified here; the ticket-edge cart summary below is
        untouched.
      */}
      <header className="bg-gradient-to-br from-espresso-900 to-espresso-800 px-5 py-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-white">
              Warenkorb
            </h1>
            <p className="mt-1 text-sm text-white/80">{menu.tenant.name}</p>
          </div>
          <Link
            href={`/r/${slug}`}
            className="shrink-0 rounded-full border border-white/25 bg-white/12 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300"
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

            {/*
              Signature ticket-edge treatment (see globals.css's `.ticket-edge`
              and packages/ui/src/tokens.ts's design-plan header comment) --
              this card literally IS the order total, so the torn-receipt
              motif is functionally motivated here, not decorative.
            */}
            <div className="ticket-edge rounded-t-lg border border-b-0 border-neutral-200 bg-neutral-0 px-4 pt-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold text-foreground">Gesamtsumme</span>
                <span className="font-display text-2xl font-semibold text-ember-700">
                  {formatPrice(cart.totalCents, cart.currency)}
                </span>
              </div>
            </div>

            {cart.checkoutReady ? (
              <Link
                href={`/r/${slug}/checkout`}
                className="rounded-md bg-brand-600 px-4 py-3 text-center font-medium text-neutral-0 transition-colors hover:bg-brand-700"
              >
                Zur Kasse
              </Link>
            ) : (
              <button
                type="button"
                disabled
                title="Bitte entfernen Sie nicht verfügbare Artikel, um fortzufahren."
                className="rounded-md bg-brand-600 px-4 py-3 font-medium text-neutral-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Zur Kasse
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
