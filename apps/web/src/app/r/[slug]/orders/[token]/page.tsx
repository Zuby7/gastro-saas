import Link from "next/link";
import { formatPrice } from "@/lib/public-menu/format";
import { getPublicMenu } from "@/lib/public-menu/fetch";
import { formatOrderTimestamp } from "@/lib/orders/format";
import { getOrderStatusByToken } from "@/lib/orders/service";
import { orderStatusDescription, orderStatusLabel } from "@/lib/orders/status-labels";
import { hashOrderAccessToken } from "@/lib/orders/token";

interface OrderStatusPageProps {
  params: Promise<{ slug: string; token: string }>;
}

/**
 * Public, token-based order-status page (ticket #22). No login, no
 * membership check -- the only "authorization" is possession of the raw
 * guest access token embedded in this route's `[token]` segment (given to
 * the customer once, right after checkout, see
 * `apps/web/src/app/r/[slug]/checkout/actions.ts`). `tenant_id`/`order_id`
 * are resolved entirely from the token's hash inside
 * `get_order_status_by_token()` -- never from `slug`, which is used here
 * only to fetch the restaurant's display name/branding for the header.
 *
 * A wrong/guessed token renders the exact same generic "not found" state
 * as any other lookup miss (acceptance criterion 1) -- this route never
 * reveals whether any order exists for a given token.
 */
export default async function OrderStatusPage({ params }: OrderStatusPageProps) {
  const { slug, token } = await params;
  const [menu, order] = await Promise.all([
    getPublicMenu(slug),
    getOrderStatusByToken(hashOrderAccessToken(token)),
  ]);

  if (!order) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 bg-neutral-50 p-8">
        <h1 className="font-display text-2xl font-semibold text-foreground">
          Bestellung nicht gefunden
        </h1>
        <p className="text-foreground-secondary">
          Für diesen Link konnte keine Bestellung gefunden werden. Bitte prüfen Sie den Link aus
          Ihrer Bestellbestätigung.
        </p>
        <Link href={`/r/${slug}`} className="font-medium text-clay-700 underline">
          Zurück zur Speisekarte
        </Link>
      </main>
    );
  }

  const fulfillmentLabel =
    order.fulfillmentType === "table"
      ? `Tischbestellung${order.tableIdentifier ? ` (Tisch ${order.tableIdentifier})` : ""}`
      : "Abholung";

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-neutral-50 px-5 py-10">
        <div className="mx-auto flex max-w-2xl flex-col gap-1">
          <p className="text-sm text-foreground-secondary">
            {menu?.tenant.name ?? "Ihre Bestellung"}
          </p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
            Bestellstatus
          </h1>
        </div>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-8">
        <section
          aria-live="polite"
          className="rounded-lg border border-clay-300 bg-neutral-0 p-5 shadow-sm"
        >
          <p className="text-sm font-medium text-foreground-secondary">Aktueller Status</p>
          <p className="mt-1 font-display text-2xl font-semibold text-clay-700">
            {orderStatusLabel(order.status)}
          </p>
          <p className="mt-2 text-sm text-foreground-secondary">
            {orderStatusDescription(order.status)}
          </p>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-neutral-0 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Details</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-foreground-secondary">Bestellart</dt>
            <dd className="text-foreground">{fulfillmentLabel}</dd>
            <dt className="text-foreground-secondary">Name</dt>
            <dd className="text-foreground">{order.customerName}</dd>
            {order.customerNote ? (
              <>
                <dt className="text-foreground-secondary">Hinweis</dt>
                <dd className="text-foreground">{order.customerNote}</dd>
              </>
            ) : null}
            <dt className="text-foreground-secondary">Bestellt am</dt>
            <dd className="text-foreground">{formatOrderTimestamp(order.createdAt)}</dd>
          </dl>
        </section>

        <section className="rounded-lg border border-neutral-200 bg-neutral-0 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground">Bestellte Artikel</h2>
          <ul className="mt-3 flex flex-col gap-3">
            {order.items.map((item, index) => (
              <li key={index} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="font-medium text-foreground">
                    {item.quantity}× {item.dishName}
                    {item.variantName ? ` (${item.variantName})` : ""}
                  </p>
                  {item.selections.length > 0 ? (
                    <p className="mt-0.5 text-foreground-secondary">
                      {item.selections.map((selection) => selection.name).join(", ")}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 text-foreground">
                  {formatPrice(item.unitPriceCents * item.quantity, order.currency)}
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between border-t border-neutral-200 pt-3">
            <span className="font-medium text-foreground">Gesamtsumme</span>
            <span className="font-display text-lg font-semibold text-clay-700">
              {formatPrice(order.totalCents, order.currency)}
            </span>
          </div>
        </section>

        {order.statusHistory.length > 0 ? (
          <section className="rounded-lg border border-neutral-200 bg-neutral-0 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">Verlauf</h2>
            <ol className="mt-3 flex flex-col gap-2 border-l border-neutral-200 pl-4">
              {order.statusHistory.map((entry, index) => (
                <li key={index} className="text-sm">
                  <p className="font-medium text-foreground">{orderStatusLabel(entry.status)}</p>
                  <p className="text-foreground-secondary">
                    {formatOrderTimestamp(entry.occurredAt)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <Link
          href={`/r/${slug}`}
          className="self-start text-sm font-medium text-clay-700 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clay-600"
        >
          Zurück zur Speisekarte
        </Link>
      </div>
    </main>
  );
}
