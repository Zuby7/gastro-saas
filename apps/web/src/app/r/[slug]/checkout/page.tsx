import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPrice } from "@/lib/public-menu/format";
import { getPublicMenu } from "@/lib/public-menu/fetch";
import { loadCartViewForDisplay } from "../cart/actions";
import { CheckoutForm } from "./checkout-form";

interface CheckoutPageProps {
  params: Promise<{ slug: string }>;
}

export default async function CheckoutPage({ params }: CheckoutPageProps) {
  const { slug } = await params;
  const menu = await getPublicMenu(slug);

  if (!menu) {
    notFound();
  }

  const cart = await loadCartViewForDisplay(slug);
  const checkoutReady = Boolean(cart?.checkoutReady);

  return (
    <main className="min-h-screen bg-neutral-50">
      {/*
        Same quieter hero-gradient treatment as `../cart/page.tsx` -- see
        that file's comment for rationale.
      */}
      <header className="bg-gradient-to-br from-[#2b1c14] to-[#4a2e1c] px-5 py-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-white">Kasse</h1>
            <p className="mt-1 text-sm text-white/80">{menu.tenant.name}</p>
          </div>
          <Link
            href={`/r/${slug}/cart`}
            className="shrink-0 rounded-full border border-white/25 bg-white/12 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300"
          >
            Zurück zum Warenkorb
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
        {!cart || cart.items.length === 0 ? (
          <p className="rounded-md border border-neutral-300 bg-neutral-0 p-4 text-foreground">
            Ihr Warenkorb ist leer.{" "}
            <Link href={`/r/${slug}`} className="font-medium text-ember-700 underline">
              Zurück zur Speisekarte
            </Link>
          </p>
        ) : (
          <>
            {/*
              The pre-submit order summary is the checkout page's "order
              confirmation moment" (see packages/ui/src/tokens.ts's design
              plan) -- it gets the same ticket-edge treatment as the cart
              summary and the order-status card, since all three literally
              represent the customer's order.
            */}
            <div className="ticket-edge rounded-t-lg border border-b-0 border-neutral-300 bg-neutral-0 px-4 pt-3 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">Gesamtsumme</span>
                <span className="font-display text-xl font-semibold text-ember-700">
                  {formatPrice(cart.totalCents, cart.currency)}
                </span>
              </div>
            </div>

            <CheckoutForm tenantSlug={slug} checkoutReady={checkoutReady} />
          </>
        )}
      </div>
    </main>
  );
}
