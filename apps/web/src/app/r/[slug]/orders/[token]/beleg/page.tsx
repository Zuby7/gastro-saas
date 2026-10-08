import Link from "next/link";
import { formatPrice } from "@/lib/public-menu/format";
import { getPublicMenu } from "@/lib/public-menu/fetch";
import { formatOrderTimestamp } from "@/lib/orders/format";
import { getOrderStatusByToken } from "@/lib/orders/service";
import { hashOrderAccessToken } from "@/lib/orders/token";
import { isOrderPaidStatus } from "@/lib/orders/receipt";
import { PrintButton } from "./print-button";

interface ReceiptPageProps {
  params: Promise<{ slug: string; token: string }>;
}

/**
 * Digital order receipt (ticket #153). Same access model as the order-status
 * page one level up: possession of the guest token is the only authorization,
 * a missing order or a slug mismatch renders the same generic "not found"
 * state (no oracle). The receipt only renders for orders the webhook has
 * already moved past `awaiting_payment` (never for cancelled ones); all
 * amounts come from the server-side order, nothing from the client.
 *
 * NOT a tax-qualified receipt: no VAT, no TSE -- see the visible legal note.
 */
export default async function ReceiptPage({ params }: ReceiptPageProps) {
  const { slug, token } = await params;
  const [menu, order] = await Promise.all([
    getPublicMenu(slug),
    getOrderStatusByToken(hashOrderAccessToken(token)),
  ]);

  if (!order || order.tenantSlug !== slug) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 bg-surface-secondary p-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Bestellung nicht gefunden
        </h1>
        <p className="text-foreground-secondary">
          Für diesen Link konnte keine Bestellung gefunden werden. Bitte prüfen Sie den Link aus
          Ihrer Bestellbestätigung.
        </p>
        <Link href={`/r/${slug}`} className="font-medium text-ember-700 underline">
          Zurück zur Speisekarte
        </Link>
      </main>
    );
  }

  if (!isOrderPaidStatus(order.status)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 bg-surface-secondary p-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Noch kein Beleg verfügbar
        </h1>
        <p className="text-foreground-secondary">
          Für diese Bestellung liegt aktuell kein Beleg vor. Ein Beleg ist erst nach erfolgreicher
          Online-Zahlung verfügbar.
        </p>
        <Link href={`/r/${slug}/orders/${token}`} className="font-medium text-ember-700 underline">
          Zurück zum Bestellstatus
        </Link>
      </main>
    );
  }

  const fulfillmentLabel =
    order.fulfillmentType === "table"
      ? `Tischbestellung${order.tableIdentifier ? ` (Tisch ${order.tableIdentifier})` : ""}`
      : "Abholung";

  // The payment webhook moves the order to `received`; its first history
  // entry is therefore the payment confirmation time (no extra RPC field).
  const paidEntry = order.statusHistory.find((entry) => entry.status === "received");

  return (
    <main className="min-h-screen bg-surface-secondary print:bg-surface">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-8 print:max-w-none print:px-0 print:py-0">
        <nav className="print:hidden" aria-label="Navigation">
          <Link
            href={`/r/${slug}/orders/${token}`}
            className="text-sm font-medium text-ember-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-600"
          >
            Zurück zum Bestellstatus
          </Link>
        </nav>

        <article className="flex flex-col gap-5 rounded-lg border border-neutral-200 bg-surface p-6 shadow-sm print:border-0 print:bg-surface print:p-0 print:shadow-none">
          <header>
            <p className="text-sm text-foreground-secondary">
              {menu?.tenant.name ?? "Ihr Restaurant"}
            </p>
            <h1 className="font-display text-2xl font-semibold text-foreground">
              Digitaler Bestellbeleg
            </h1>
          </header>

          <section aria-labelledby="receipt-details">
            <h2 id="receipt-details" className="text-sm font-semibold text-foreground">
              Bestelldaten
            </h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-foreground-secondary">Bestellt am</dt>
              <dd className="text-foreground">{formatOrderTimestamp(order.createdAt)}</dd>
              <dt className="text-foreground-secondary">Bestellart</dt>
              <dd className="text-foreground">{fulfillmentLabel}</dd>
              <dt className="text-foreground-secondary">Zahlung</dt>
              <dd className="text-foreground">Online bezahlt</dd>
              {paidEntry ? (
                <>
                  <dt className="text-foreground-secondary">Bezahlt am</dt>
                  <dd className="text-foreground">{formatOrderTimestamp(paidEntry.occurredAt)}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section aria-labelledby="receipt-items">
            <h2 id="receipt-items" className="text-sm font-semibold text-foreground">
              Positionen
            </h2>
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-foreground-secondary">
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Artikel
                  </th>
                  <th scope="col" className="py-1 pr-2 text-right font-medium">
                    Einzelpreis
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Summe
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item, index) => (
                  <tr key={index} className="border-b border-neutral-200 align-top">
                    <th scope="row" className="py-2 pr-2 font-medium text-foreground">
                      {item.quantity}× {item.dishName}
                      {item.variantName ? ` (${item.variantName})` : ""}
                      {item.selections.length > 0 ? (
                        <span className="mt-0.5 block font-normal text-foreground-secondary">
                          {item.selections.map((selection) => selection.name).join(", ")}
                        </span>
                      ) : null}
                    </th>
                    <td className="py-2 pr-2 text-right text-foreground">
                      {formatPrice(item.unitPriceCents, order.currency)}
                    </td>
                    <td className="py-2 text-right text-foreground">
                      {formatPrice(item.unitPriceCents * item.quantity, order.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center justify-between">
              <span className="font-medium text-foreground">Gesamtsumme</span>
              <span className="font-display text-lg font-semibold text-foreground">
                {formatPrice(order.totalCents, order.currency)}
              </span>
            </div>
          </section>

          <p className="border-t border-neutral-200 pt-3 text-sm text-foreground-secondary">
            Digitaler Bestellbeleg – kein steuerlich qualifizierter Kassenbeleg.
          </p>
        </article>

        <PrintButton />
      </div>
    </main>
  );
}
