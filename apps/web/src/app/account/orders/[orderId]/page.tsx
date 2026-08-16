import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { getPaymentRefundSummary } from "@/lib/payments/refund-service";
import { RefundForm } from "./refund-form";

interface OrderRow {
  id: string;
  status: string;
  fulfillment_type: string;
  customer_name: string;
  total_cents: number;
  currency: string;
  created_at: string;
}

const REFUND_STATUS_LABEL: Record<string, string> = {
  pending: "Ausstehend",
  succeeded: "Erfolgreich",
  failed: "Fehlgeschlagen",
  // Ambiguous Stripe failure (network timeout/connection drop) -- Stripe may
  // or may not have actually processed the refund; still reserved against
  // the payment's remaining refundable amount pending manual reconciliation
  // (Opus epic-7 batch review finding 1).
  unconfirmed: "Ungeklärt (manuell prüfen)",
};

/**
 * Minimal staff-facing order detail + refund admin view (ticket #26). Epic 8
 * (kitchen/live order dashboard) has not shipped yet, so this deliberately
 * does not attempt a full order-management surface -- it is scoped exactly
 * to what this ticket needs: look up one order by id, show its payment/
 * refund history, and let a `payments.refund` holder issue a refund.
 *
 * Gated on `payments.read` for the page itself (viewing payment/refund
 * history is a financial-data read); the refund form additionally requires
 * `payments.refund` (checked separately so a `payments.read`-only viewer
 * sees the history without a refund control they can't use).
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
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
    await requireTenantPermission(supabase, membership.tenantId, "payments.read");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-neutral-50 p-8">
          <p role="alert" className="text-foreground">
            Sie haben nicht die erforderliche Berechtigung, um Zahlungs-/Rückerstattungsdaten
            einzusehen.
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

  const { data: order } = await supabase
    .from("orders")
    .select("id, status, fulfillment_type, customer_name, total_cents, currency, created_at")
    .eq("id", orderId)
    .eq("tenant_id", membership.tenantId)
    .maybeSingle<OrderRow>();

  if (!order) {
    notFound();
  }

  const summary = await getPaymentRefundSummary(supabase, {
    tenantId: membership.tenantId,
    orderId: order.id,
  });

  let canRefund = false;
  try {
    await requireTenantPermission(supabase, membership.tenantId, "payments.refund");
    canRefund = true;
  } catch (error) {
    if (!(error instanceof PermissionDeniedError)) {
      throw error;
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Bestellung {order.id}
          </h1>
          <Link
            href="/account"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </div>

        <section
          aria-labelledby="order-details-heading"
          className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-6"
        >
          <h2 id="order-details-heading" className="text-lg font-medium text-foreground">
            Bestelldetails
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-foreground">
            <dt>Status</dt>
            <dd>{order.status}</dd>
            <dt>Kunde</dt>
            <dd>{order.customer_name}</dd>
            <dt>Art</dt>
            <dd>{order.fulfillment_type}</dd>
            <dt>Gesamtbetrag</dt>
            <dd>
              {(order.total_cents / 100).toFixed(2)} {order.currency}
            </dd>
          </dl>
        </section>

        <section
          aria-labelledby="refund-history-heading"
          className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-6"
        >
          <h2 id="refund-history-heading" className="text-lg font-medium text-foreground">
            Zahlung &amp; Rückerstattungen
          </h2>

          {!summary ? (
            <p className="text-sm text-foreground">
              Für diese Bestellung liegt keine bezahlte Zahlung vor.
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-foreground">
                <dt>Bezahlter Betrag</dt>
                <dd>
                  {(summary.amountCents / 100).toFixed(2)} {summary.currency}
                </dd>
                <dt>Bereits rückerstattet/reserviert</dt>
                <dd>
                  {(summary.refundedOrReservedCents / 100).toFixed(2)} {summary.currency}
                </dd>
                <dt>Noch rückerstattbar</dt>
                <dd>
                  {(summary.remainingRefundableCents / 100).toFixed(2)} {summary.currency}
                </dd>
              </dl>

              {summary.refunds.length > 0 ? (
                <table className="w-full text-left text-sm text-foreground">
                  <caption className="sr-only">Rückerstattungshistorie</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="py-1">
                        Betrag
                      </th>
                      <th scope="col" className="py-1">
                        Grund
                      </th>
                      <th scope="col" className="py-1">
                        Status
                      </th>
                      <th scope="col" className="py-1">
                        Zeitpunkt
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.refunds.map((refund) => (
                      <tr key={refund.id} className="border-t border-neutral-200">
                        <td className="py-1">
                          {(refund.amountCents / 100).toFixed(2)} {refund.currency}
                        </td>
                        <td className="py-1">{refund.reason}</td>
                        <td className="py-1">
                          {REFUND_STATUS_LABEL[refund.status] ?? refund.status}
                        </td>
                        <td className="py-1">
                          {new Date(refund.createdAt).toLocaleString("de-DE")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-foreground">Bisher keine Rückerstattungen.</p>
              )}

              {canRefund ? (
                <RefundForm
                  orderId={order.id}
                  remainingRefundableCents={summary.remainingRefundableCents}
                />
              ) : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
