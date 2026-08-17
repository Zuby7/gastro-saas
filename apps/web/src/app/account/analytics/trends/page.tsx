import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import {
  getTrendComparison,
  type TrendComparison,
  type TrendPeriodType,
} from "@/lib/analytics/trend-service";
import { getExtrasPerformance } from "@/lib/analytics/extras-service";
import type { ExtraPerformanceResult } from "@gastro-saas/domain";

const PERIOD_LABEL: Record<TrendPeriodType, string> = {
  day: "Heute vs. Vortag",
  week: "Diese Woche vs. Vorwoche",
  month: "Dieser Monat vs. Vormonat",
  custom: "Freier Zeitraum vs. gleich langer Vorzeitraum",
};

function formatMoney(cents: number, currency = "EUR"): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

function formatPercent(value: number | null): string {
  if (value === null) return "–";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)} %`;
}

function formatPercentValue(value: number | null): string {
  if (value === null) return "–";
  return `${(value * 100).toFixed(1)} %`;
}

function isValidPeriodType(value: string | undefined): value is TrendPeriodType {
  return value === "day" || value === "week" || value === "month" || value === "custom";
}

/**
 * Trendvergleiche und Extras-Analytics (ticket #32, Epic 9): period-vs-prior-
 * period comparison (today/vortag, week/week, month/month, or a custom range
 * vs. an equal-length prior range) plus an extras (paid options) selection-
 * rate/additional-revenue table.
 *
 * Gated on `analytics.read`, two enforcement layers (same pattern as
 * `/account/analytics`/`/account/analytics/dishes`): this page's own
 * `requireTenantPermission` check, plus both RPCs' independent re-checks.
 *
 * Period selector: a plain GET `<form>` with a native `<select>` and (for
 * the custom range) `<input type="date">` fields -- fully keyboard-operable
 * without any client-side JavaScript (accessibility requirement: "Zeitraum-
 * Auswahl per Tastatur bedienbar").
 *
 * Acceptance criterion 1 ("Ein unvollständiger aktueller Zeitraum wird nicht
 * unkommentiert mit einem vollständigen Vorzeitraum verglichen"): whenever
 * `compareTrendPeriods()` (via `getTrendComparison()`) reports a
 * `comparisonCaveat`, it's rendered directly alongside the percentages, not
 * hidden and not silently omitted.
 *
 * **Known, explicitly incomplete scope** (see the migration's header and
 * `docs/data/domain-model.md` "Analytics"): removed-ingredient analysis is
 * NOT implemented -- there is no data model anywhere that records a
 * customer's per-order choice to remove an ingredient (`removable_ingredients`
 * is only a menu-catalog table, never a per-order fact). This page says so
 * explicitly rather than showing a fabricated empty/zero table.
 */
export default async function TrendsAndExtrasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
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
            Sie haben nicht die erforderliche Berechtigung, um Trend- und Extras-Analysen
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

  const rawPeriodType = Array.isArray(params.period) ? params.period[0] : params.period;
  const periodType: TrendPeriodType = isValidPeriodType(rawPeriodType) ? rawPeriodType : "day";
  const customStart = Array.isArray(params.start) ? params.start[0] : params.start;
  const customEnd = Array.isArray(params.end) ? params.end[0] : params.end;

  let trend: TrendComparison | null = null;
  let trendError: string | null = null;

  if (periodType !== "custom" || (customStart && customEnd)) {
    try {
      trend = await getTrendComparison(supabase, membership.tenantId, {
        periodType,
        customStart,
        customEnd,
      });
    } catch (error) {
      trendError =
        error instanceof Error
          ? error.message
          : "Der Zeitraumvergleich konnte nicht geladen werden.";
    }
  }

  const extras = await getExtrasPerformance(supabase, membership.tenantId);

  return (
    <main className="min-h-screen bg-neutral-50">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Trends &amp; Extras
          </h1>
          <Link
            href="/account/analytics"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück zum Dashboard
          </Link>
        </div>

        <section
          aria-labelledby="trend-widget-heading"
          className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-6"
        >
          <h2 id="trend-widget-heading" className="text-lg font-medium text-foreground">
            Zeitraumvergleich
          </h2>

          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="period-select" className="text-sm font-medium text-foreground">
                Zeitraum
              </label>
              <select
                id="period-select"
                name="period"
                defaultValue={periodType}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-foreground"
              >
                <option value="day">Heute vs. Vortag</option>
                <option value="week">Diese Woche vs. Vorwoche</option>
                <option value="month">Dieser Monat vs. Vormonat</option>
                <option value="custom">Freier Zeitraum</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="start-date" className="text-sm font-medium text-foreground">
                Von
              </label>
              <input
                id="start-date"
                type="date"
                name="start"
                defaultValue={customStart}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-foreground"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="end-date" className="text-sm font-medium text-foreground">
                Bis (ausschließlich)
              </label>
              <input
                id="end-date"
                type="date"
                name="end"
                defaultValue={customEnd}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-foreground"
              />
            </div>
            <button
              type="submit"
              className="rounded-md border border-neutral-300 bg-brand-600 px-4 py-2 text-sm font-medium text-white"
            >
              Anwenden
            </button>
          </form>

          {trendError ? (
            <p role="alert" className="text-sm text-foreground">
              {trendError}
            </p>
          ) : trend ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-foreground">{PERIOD_LABEL[trend.periodType]}</p>

              {trend.comparisonCaveat ? (
                <p role="alert" className="text-sm font-medium text-foreground">
                  {trend.comparisonCaveat}
                </p>
              ) : null}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-foreground sm:grid-cols-4">
                <dt>Umsatz (netto), aktuell</dt>
                <dd>{formatMoney(trend.current.netRevenueCents)}</dd>
                <dt>Umsatz (netto), Vorzeitraum</dt>
                <dd>{formatMoney(trend.previous.netRevenueCents)}</dd>
                <dt>Veränderung Umsatz</dt>
                <dd>{formatPercent(trend.netRevenueChangePercent)}</dd>
                <dt>Stichprobengröße (bezahlte Bestellungen)</dt>
                <dd>
                  {trend.current.paidOrdersCount} (aktuell) / {trend.previous.paidOrdersCount}{" "}
                  (Vorzeitraum)
                </dd>
                <dt>Veränderung Bestellungen</dt>
                <dd>{formatPercent(trend.paidOrdersChangePercent)}</dd>
              </dl>
            </div>
          ) : (
            <p className="text-sm text-foreground">
              Bitte Start- und Enddatum für den freien Zeitraum angeben.
            </p>
          )}
        </section>

        <section
          aria-labelledby="extras-heading"
          className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-6"
        >
          <h2 id="extras-heading" className="text-lg font-medium text-foreground">
            Extras-Auswertung
          </h2>
          <p className="text-sm text-foreground">
            Auswahlrate und zusätzlicher Umsatz je Extra, letzte 30 Tage, für aktuell
            veröffentlichte Gerichte.
          </p>

          {extras.length === 0 ? (
            <p className="text-sm text-foreground">
              Keine Extras auf dem aktuell veröffentlichten Menü.
            </p>
          ) : (
            <ExtrasTable extras={extras} />
          )}
        </section>

        <section
          aria-labelledby="removed-ingredients-heading"
          className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-6"
        >
          <h2 id="removed-ingredients-heading" className="text-lg font-medium text-foreground">
            Entfernte Zutaten
          </h2>
          <p className="text-sm text-foreground">
            Diese Auswertung ist noch nicht verfügbar: Es gibt aktuell keine Erfassung, welche
            Zutaten Gäste bei einer Bestellung entfernt haben. Eine Umsetzung erfordert eine eigene
            Datenmodell-Erweiterung des Bestellvorgangs und ist nicht Teil dieses Tickets.
          </p>
        </section>
      </div>
    </main>
  );
}

function ExtrasTable({ extras }: { extras: ExtraPerformanceResult[] }) {
  return (
    <table className="w-full text-left text-sm text-foreground">
      <caption className="sr-only">Extras-Auswertung</caption>
      <thead>
        <tr>
          <th scope="col" className="py-1">
            Extra
          </th>
          <th scope="col" className="py-1">
            Auswahlrate
          </th>
          <th scope="col" className="py-1">
            Auswahlen / Gelegenheiten
          </th>
          <th scope="col" className="py-1">
            Zusätzlicher Umsatz
          </th>
        </tr>
      </thead>
      <tbody>
        {extras.map((extra) => (
          <tr key={extra.optionId} className="border-t border-neutral-200">
            <td className="py-1">{extra.optionName}</td>
            <td className="py-1">{formatPercentValue(extra.selectionRate)}</td>
            <td className="py-1">
              {extra.selectionCount} / {extra.eligibleOrderItemCount}
            </td>
            <td className="py-1">{formatMoney(extra.additionalRevenueCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
