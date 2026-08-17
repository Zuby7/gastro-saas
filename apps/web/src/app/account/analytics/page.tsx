import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { getAnalyticsDashboardSummary } from "@/lib/analytics/dashboard-service";

function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

/**
 * Analytics-Grunddashboard (ticket #30, Epic 9): revenue today, paid order
 * count, average order value, open orders, payment failures -- computed
 * exclusively from this tenant's own orders/payments/refunds data (explicit
 * non-goal: no third-party product analytics for revenue figures).
 *
 * Gated on `analytics.read`, two enforcement layers per
 * `.claude/rules/tenant-isolation.md`:
 *   1. This page calls `requireTenantPermission` before rendering anything,
 *      so a member without the permission sees a plain access-denied message
 *      (mirrors `account/payments/page.tsx`'s precedent).
 *   2. `get_analytics_dashboard_summary()` itself independently re-checks the
 *      same permission via `require_tenant_permission` -- a bug or bypass in
 *      (1) can never let an unauthorized session read revenue data.
 *
 * Empty states (acceptance criterion 3): average order value renders "–"
 * (never a fabricated 0) when there were no paid orders today, and every
 * tile pairs its number with a plain-text label/unit -- no chart-only
 * information (accessibility requirement: "Kennzahlen mit Textalternative,
 * nicht nur Diagramm").
 */
export default async function AnalyticsDashboardPage() {
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
    await requireTenantPermission(supabase, membership.tenantId, "analytics.read");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-neutral-50 p-8">
          <p role="alert" className="text-foreground">
            Sie haben nicht die erforderliche Berechtigung, um das Analytics-Dashboard einzusehen.
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

  const summary = await getAnalyticsDashboardSummary(supabase, membership.tenantId);
  const hasPaidOrdersToday = summary.paidOrdersTodayCount > 0;

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Analytics-Dashboard
          </h1>
          <Link
            href="/account"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </div>

        <p className="text-sm text-foreground">
          Alle Kennzahlen ausschließlich aus den eigenen Bestell- und Zahlungsdaten, Zeitzone{" "}
          {summary.timezone}.
        </p>

        <Link
          href="/account/analytics/trends"
          className="w-fit text-sm font-medium text-link-foreground underline hover:text-brand-700"
        >
          Trends &amp; Extras ansehen
        </Link>

        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
          aria-label="Kennzahlen"
        >
          <section
            role="listitem"
            aria-labelledby="revenue-heading"
            className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-6"
          >
            <h2 id="revenue-heading" className="text-sm font-medium text-foreground">
              Umsatz heute (netto)
            </h2>
            <p className="text-2xl font-semibold text-foreground">
              {hasPaidOrdersToday
                ? formatMoney(summary.netRevenueTodayCents, summary.currency)
                : "–"}
            </p>
            {!hasPaidOrdersToday ? (
              <p className="text-sm text-foreground">Noch keine bezahlten Bestellungen heute.</p>
            ) : summary.refundsTodayCents > 0 ? (
              <p className="text-sm text-foreground">
                Brutto {formatMoney(summary.grossRevenueTodayCents, summary.currency)}, abzüglich{" "}
                {formatMoney(summary.refundsTodayCents, summary.currency)} Rückerstattungen.
              </p>
            ) : null}
          </section>

          <section
            role="listitem"
            aria-labelledby="paid-orders-heading"
            className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-6"
          >
            <h2 id="paid-orders-heading" className="text-sm font-medium text-foreground">
              Bezahlte Bestellungen heute
            </h2>
            <p className="text-2xl font-semibold text-foreground">{summary.paidOrdersTodayCount}</p>
            {!hasPaidOrdersToday ? (
              <p className="text-sm text-foreground">Noch keine bezahlten Bestellungen heute.</p>
            ) : null}
          </section>

          <section
            role="listitem"
            aria-labelledby="avg-order-value-heading"
            className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-6"
          >
            <h2 id="avg-order-value-heading" className="text-sm font-medium text-foreground">
              Ø-Bestellwert
            </h2>
            <p className="text-2xl font-semibold text-foreground">
              {summary.avgOrderValueCents !== null
                ? formatMoney(summary.avgOrderValueCents, summary.currency)
                : "–"}
            </p>
            {summary.avgOrderValueCents === null ? (
              <p className="text-sm text-foreground">
                Noch nicht genug Daten für einen Durchschnittswert.
              </p>
            ) : null}
          </section>

          <section
            role="listitem"
            aria-labelledby="open-orders-heading"
            className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-6"
          >
            <h2 id="open-orders-heading" className="text-sm font-medium text-foreground">
              Offene Bestellungen
            </h2>
            <p className="text-2xl font-semibold text-foreground">{summary.openOrdersCount}</p>
            {summary.openOrdersCount === 0 ? (
              <p className="text-sm text-foreground">Aktuell keine offenen Bestellungen.</p>
            ) : null}
          </section>

          <section
            role="listitem"
            aria-labelledby="payment-failures-heading"
            className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white p-6"
          >
            <h2 id="payment-failures-heading" className="text-sm font-medium text-foreground">
              Zahlungsfehlschläge heute
            </h2>
            <p className="text-2xl font-semibold text-foreground">
              {summary.paymentFailuresTodayCount}
            </p>
            {summary.paymentFailuresTodayCount === 0 ? (
              <p className="text-sm text-foreground">Keine Zahlungsfehlschläge heute.</p>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
