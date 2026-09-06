import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import {
  getDishPerformanceAnalysis,
  type DishPerformanceWithManualSales,
} from "@/lib/analytics/dish-performance-service";
import type { DishPerformanceLabel } from "@gastro-saas/domain";

const LABEL_TEXT: Record<DishPerformanceLabel, string> = {
  topseller: "Topseller",
  low_performer: "Low Performer",
  insufficient_data: "Zu wenig Daten",
  normal: "—",
};

function formatMoney(cents: number, currency: string): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

function formatConversion(rate: number | null): string {
  if (rate === null) return "–";
  return `${(rate * 100).toFixed(1)} %`;
}

/**
 * Topseller-/Low-Performer-Analyse (ticket #31, Epic 9): ranks the tenant's
 * currently published dishes by quantity sold and revenue, and flags
 * topsellers/low performers -- always alongside their underlying evidence
 * numbers (views, add-to-cart, purchases, conversion), never an unexplained
 * label (acceptance criterion 2). A dish never gets flagged "Low Performer"
 * without a minimum data basis (acceptance criterion 1) -- it's labeled "Zu
 * wenig Daten" instead. Explicit non-goal: no automatic root-cause
 * attribution (e.g. "the price is to blame") is ever shown -- only the raw
 * numbers.
 *
 * Gated on `analytics.read`, two enforcement layers (same pattern as
 * `/account/analytics`): this page's own `requireTenantPermission` check,
 * plus `get_dish_performance_stats()`'s independent re-check.
 *
 * Rendered as a single accessible table with header cells (accessibility
 * requirement: "Liste ist als Tabelle mit Kopfzeilen zugänglich"), sortable
 * views omitted in favor of two explicit, clearly-labeled orderings
 * (quantity vs. revenue) so the "Mengen- vs. Umsatz-Unterscheidung" this
 * ticket calls out is visible directly in the UI, not just in the ranking
 * math.
 */
export default async function DishPerformancePage() {
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
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-surface-secondary p-8">
          <p role="alert" className="text-foreground">
            Sie haben nicht die erforderliche Berechtigung, um die Gerichte-Analyse einzusehen.
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

  const dishes = await getDishPerformanceAnalysis(supabase, membership.tenantId);
  const byQuantity = [...dishes].sort((a, b) => a.quantityRank - b.quantityRank);
  const byRevenue = [...dishes].sort((a, b) => a.revenueRank - b.revenueRank);

  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Topseller &amp; Low Performer
          </h1>
          <Link
            href="/account/analytics"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück zum Dashboard
          </Link>
        </div>

        <p className="text-sm text-foreground">
          Ranking der letzten 30 Tage, ausschließlich für aktuell veröffentlichte Gerichte. Eine
          Kennzeichnung als &quot;Low Performer&quot; erscheint erst, wenn genug Daten vorliegen --
          ein neues oder selten aufgerufenes Gericht wird nie ohne ausreichende Datenbasis so
          bezeichnet.
        </p>

        {dishes.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 bg-surface p-6 text-sm text-foreground">
            Noch keine veröffentlichten Gerichte oder noch keine Daten für diesen Zeitraum.
          </p>
        ) : (
          <>
            {dishes.every((dish) => dish.viewsCount === 0 && dish.addToCartCount === 0) ? (
              <p
                role="status"
                className="rounded-lg border border-neutral-200 bg-surface p-6 text-sm text-foreground"
              >
                Die Spalten &quot;Aufrufe&quot; und &quot;Warenkorb-Hinzufügungen&quot; sind noch
                nicht verfügbar: Es gibt aktuell keine Erfassung von Gericht-Aufrufen oder
                Warenkorb-Hinzufügungen, daher zeigen diese Spalten für alle Gerichte 0 an, statt
                einer echten Messung. Verkaufte Menge und Umsatz basieren dagegen auf echten
                Bestelldaten und sind zuverlässig.
              </p>
            ) : null}
            <DishPerformanceTable
              headingId="by-quantity-heading"
              heading="Ranking nach verkaufter Menge"
              dishes={byQuantity}
            />
            <DishPerformanceTable
              headingId="by-revenue-heading"
              heading="Ranking nach Umsatz"
              dishes={byRevenue}
            />
          </>
        )}
      </div>
    </main>
  );
}

function DishPerformanceTable({
  headingId,
  heading,
  dishes,
}: {
  headingId: string;
  heading: string;
  dishes: DishPerformanceWithManualSales[];
}) {
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface p-6"
    >
      <h2 id={headingId} className="text-lg font-medium text-foreground">
        {heading}
      </h2>
      <p className="text-sm text-foreground-secondary">
        Ranking und Kennzeichnung basieren ausschließlich auf echten Bestelldaten. Die Spalten
        &quot;Manuell nachgetragen&quot; zeigen zusätzlich, klar getrennt, außerhalb des
        Bestellsystems erfasste Verkäufe (nicht Teil des Rankings).
      </p>
      <table className="w-full text-left text-sm text-foreground">
        <caption className="sr-only">{heading}</caption>
        <thead>
          <tr>
            <th scope="col" className="py-1">
              Gericht
            </th>
            <th scope="col" className="py-1">
              Kennzeichnung
            </th>
            <th scope="col" className="py-1">
              Verkaufte Menge
            </th>
            <th scope="col" className="py-1">
              Umsatz
            </th>
            <th scope="col" className="py-1">
              Aufrufe
            </th>
            <th scope="col" className="py-1">
              Warenkorb-Hinzufügungen
            </th>
            <th scope="col" className="py-1">
              Conversion
            </th>
            <th scope="col" className="py-1">
              Manuell nachgetragen (Menge)
            </th>
            <th scope="col" className="py-1">
              Manuell nachgetragen (geschätzter Umsatz)
            </th>
          </tr>
        </thead>
        <tbody>
          {dishes.map((dish) => (
            <tr key={dish.dishId} className="border-t border-neutral-200">
              <td className="py-1">{dish.dishName}</td>
              <td className="py-1">{LABEL_TEXT[dish.label]}</td>
              <td className="py-1">{dish.unitsSold}</td>
              <td className="py-1">{formatMoney(dish.revenueCents, dish.currency)}</td>
              <td className="py-1">{dish.viewsCount}</td>
              <td className="py-1">{dish.addToCartCount}</td>
              <td className="py-1">{formatConversion(dish.conversionRate)}</td>
              <td className="py-1">{dish.manualUnitsSold}</td>
              <td className="py-1">
                {formatMoney(dish.manualEstimatedRevenueCents, dish.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
