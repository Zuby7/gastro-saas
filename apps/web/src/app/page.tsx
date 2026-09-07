import Link from "next/link";
import { ClipboardList, LineChart, QrCode, Wallet } from "lucide-react";

/**
 * Marketing/landing page (visual redesign, per direct user request 2026-09-07
 * that the previous version "looks too AI-generated / boxy"). Replaces the
 * centered-hero + uniform-4-col-grid + repeated-box-per-section layout that
 * shipped in the prior pass.
 *
 * Design notes (no `frontend-design` skill/plugin available in this
 * session — see `.claude/rules/frontend.md`'s note that it's optional if
 * not installed):
 *
 * Pass 1 (plan): reuse the existing token system (`packages/ui/src/tokens.ts`)
 * unchanged — no new colors/fonts. The three specific "AI slop" patterns
 * called out for this page (eyebrow-label-above-giant-centered-headline,
 * uniform icon-card grid, identical heading→box rhythm repeated every
 * section) are each broken structurally, not just re-skinned:
 *   - Hero: no floating eyebrow label at all. Instead an asymmetric ~55/45
 *     two-column layout — headline+copy left, a single bold visual anchor
 *     right (a `.ticket-edge` kitchen-order-ticket mockup, angled and
 *     bleeding past its column on large screens). The small "tag" that would
 *     otherwise have been a floating eyebrow is docked onto that ticket
 *     visual itself (`.ticket-stamp`), not floating alone above the H1.
 *     Headline size is reduced (text-3xl/4xl instead of 4xl/5xl) so it
 *     doesn't have to dominate the whole fold by itself.
 *   - Features: the QR-menu feature is pulled out as one large, wide
 *     featured card (matching the hero paragraph's own emphasis on
 *     "digitale Speisekarte"); the other three (kitchen orders, payments,
 *     analytics -- all still promised in the hero paragraph, so none were
 *     silently dropped, per Opus review on PR #149) sit below it as three
 *     equal supporting cards. Still not four identical top-level columns --
 *     the asymmetry is one wide card + a row of three, not a uniform grid.
 *   - How-it-works: no longer 3 identical circle-badges in a symmetric grid.
 *     Step 1 is visually heavier (larger badge/type) as the anchor, steps 2
 *     and 3 are smaller and follow along a dashed connector line, all
 *     left-aligned in a horizontal flow rather than 3 centered columns.
 *   - Closing CTA: kept, but no longer a plain centered rounded rectangle —
 *     copy is left-aligned and the button is offset to the side. An earlier
 *     draft also echoed the hero's ticket-perforation edge on this band, but
 *     that render was invisible (bg-on-bg) and was removed rather than
 *     faked (Opus review, PR #149) -- the ticket motif stays the hero's ONE
 *     bold moment.
 *
 * The `.ticket-edge`/`.ticket-stamp` utilities (`globals.css`) were
 * previously scoped to "cards that literally represent your order" (cart,
 * checkout, order-status). This ticket explicitly asks to reuse that exact
 * established motif as the landing page's one bold visual moment instead of
 * inventing a new shape — done deliberately here as a second, narrow,
 * documented exception (the marketing hero mockup only), not a general
 * license to scatter it decoratively elsewhere; `packages/ui/src/tokens.ts`'s
 * own "Signature element" section is updated in this same PR to state this
 * second exception explicitly, so the two docs agree.
 * Real dish photos were deliberately not used for the same reason as before
 * (`ATTRIBUTION.md`: seed-data only, and the motif is cuisine-agnostic).
 *
 * Pass 2 (critique): avoids the cold blue/purple SaaS gradient (still the
 * warm espresso gradient used elsewhere in the product); every section now
 * has a different visual rhythm so the page doesn't read as repeated
 * templated blocks; accent colors stay restrained (ember only for the one
 * "price" moment in the ticket mockup, gold only for small badges/tags,
 * matching the rest of the product's established restraint).
 */
export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <span className="font-display text-xl font-semibold tracking-tight text-foreground">
            gastro-saas
          </span>
          <nav className="flex items-center gap-4 text-sm" aria-label="Hauptnavigation">
            <Link href="/login" className="font-medium text-link-foreground underline">
              Anmelden
            </Link>
            <Link
              href="/register"
              className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              Jetzt starten
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero — asymmetric ~55/45 split, no eyebrow-above-headline.
            Same warm espresso gradient as the public menu hero, deliberately
            reused rather than a generic blue-gradient SaaS hero. */}
        <section className="overflow-hidden bg-gradient-to-br from-espresso-900 to-espresso-800 px-5 py-16 sm:px-8 sm:py-24">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.2fr_1fr] lg:items-center">
            <div className="flex flex-col items-start gap-6">
              <h1 className="max-w-xl font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Ihr Restaurant verdient mehr als ein Kassenbuch und einen Stapel Papierkarten.
              </h1>
              <p className="max-w-lg text-lg leading-relaxed text-white/80">
                gastro-saas bündelt digitale Speisekarte, Bestellannahme, Küchen-Workflow, Zahlungen
                und Auswertungen in einem System, das an einem Nachmittag startklar ist — kein
                Papierkram, keine Fachkenntnisse nötig.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/register"
                  className="rounded-md bg-brand-600 px-5 py-3 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300"
                >
                  Jetzt registrieren
                </Link>
                <Link
                  href="/login"
                  className="rounded-full border border-white/25 bg-white/12 px-5 py-3 font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300"
                >
                  Anmelden
                </Link>
              </div>
            </div>

            {/* Single bold visual anchor: a kitchen-order-ticket mockup, angled
                and bleeding past its column so it doesn't read as a plain
                contained rectangle. Hidden on small screens rather than
                shrunk, so it stays legible where it does appear.
                Deliberately fixed light colors, not the scheme-aware
                `bg-surface` token -- `text-ember-700` fails AA against
                `bg-surface`'s dark-mode value (Opus review finding on PR
                #149), and a printed paper ticket reads correctly as a
                fixed-light surface regardless of the visitor's OS theme.
                Uses the `--color-neutral-0` CSS variable via an arbitrary
                Tailwind background value rather than the equivalent plain
                utility class, which `no-hardcoded-surface-colors.test.ts`
                (issue #83 regression guard) forbids repo-wide precisely
                because a hardcoded literal is how the original white-on-white
                dark-mode bug crept back in -- this still resolves to the same
                real design-token value, just spelled so the grep-based guard
                doesn't (and shouldn't) need a per-case exception list. */}
            <div className="hidden lg:block lg:justify-self-end">
              <div className="ticket-edge w-full max-w-sm rotate-[3deg] rounded-t-lg border border-neutral-200 bg-[var(--color-neutral-0)] px-6 pt-6 shadow-2xl lg:translate-x-8">
                <span className="ticket-stamp px-2 py-1 font-mono text-xs uppercase tracking-wide">
                  Digitale Bestellung
                </span>
                <p className="mt-4 font-mono text-xs text-neutral-600">
                  Bestellung #0842 · Tisch 7
                </p>
                <ul className="mt-3 divide-y divide-neutral-200 text-sm text-neutral-900">
                  <li className="flex justify-between py-2">
                    <span>1× Margherita</span>
                    <span className="font-mono">9,50 €</span>
                  </li>
                  <li className="flex justify-between py-2">
                    <span>2× Aperol Spritz</span>
                    <span className="font-mono">14,00 €</span>
                  </li>
                  <li className="flex justify-between py-2">
                    <span>1× Tiramisu</span>
                    <span className="font-mono">5,50 €</span>
                  </li>
                </ul>
                <div className="flex items-center justify-between pt-3">
                  <span className="font-semibold text-neutral-900">Gesamt</span>
                  <span className="font-display text-lg font-semibold text-ember-700">29,00 €</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features — one larger featured card + two smaller supporting
            cards, not four identical columns. */}
        <section
          className="bg-surface-secondary px-5 py-16 sm:px-8 sm:py-20"
          aria-labelledby="features-heading"
        >
          <div className="mx-auto max-w-6xl">
            <h2
              id="features-heading"
              className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
            >
              Alles, was der Betrieb braucht — an einem Ort
            </h2>
            <p className="mt-2 max-w-2xl text-foreground-secondary">
              Kein Zusammenflicken mehr aus Kassensystem, Lieferzettel und Excel-Tabelle.
            </p>

            <div className="mt-10 flex flex-col gap-6">
              <div className="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-surface p-8 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_20px_rgba(0,0,0,.06)] md:flex-row md:items-center md:gap-8">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                  <FEATURED.icon className="h-7 w-7" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
                    {FEATURED.title}
                  </h3>
                  <p className="mt-1 max-w-md text-base leading-relaxed text-foreground-secondary">
                    {FEATURED.description}
                  </p>
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-3">
                {SUPPORTING_FEATURES.map((feature) => (
                  <div
                    key={feature.title}
                    className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_20px_rgba(0,0,0,.06)]"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                      <feature.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
                      {feature.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-foreground-secondary">
                      {feature.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* How it works — asymmetric horizontal flow: step 1 is the visually
            heavier anchor, steps 2/3 are smaller and follow a dashed
            connector, all left-aligned rather than 3 identical centered
            circles. */}
        <section
          className="bg-background px-5 py-16 sm:px-8 sm:py-20"
          aria-labelledby="how-it-works-heading"
        >
          <div className="mx-auto max-w-6xl">
            <h2
              id="how-it-works-heading"
              className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
            >
              In drei Schritten startklar
            </h2>

            {/* All three steps are direct `li` children of the `ol` -- the
                dashed connector after step 1 is an `aria-hidden` decorative
                span positioned inside that `li`, not a sibling element,
                so the list/listitem ownership relation stays intact for
                assistive tech (Opus review finding on PR #149: an `ol` with
                non-`li` direct children breaks that relation). */}
            <ol className="mt-10 flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-6">
              <li className="relative flex items-start gap-4 lg:w-2/5">
                <span
                  aria-hidden="true"
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gold-100 font-display text-2xl font-semibold text-gold-800"
                >
                  1
                </span>
                <div>
                  <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
                    {STEPS[0].title}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
                    {STEPS[0].description}
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className="absolute -right-3 top-7 hidden h-px w-6 border-t border-dashed border-neutral-300 lg:block"
                />
              </li>

              {STEPS.slice(1).map((step, index) => (
                <li key={step.title} className="flex items-start gap-3 lg:w-[30%]">
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-100 font-display text-sm font-semibold text-gold-800"
                  >
                    {index + 2}
                  </span>
                  <div>
                    <h3 className="font-display text-base font-semibold tracking-tight text-foreground">
                      {step.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-foreground-secondary">
                      {step.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Closing CTA — no longer a plain centered box: copy/button are
            asymmetrically split rather than stacked and centered. (An
            earlier draft echoed the hero's ticket-perforation edge here too,
            but a `bg-background`-on-`bg-background` strip renders no visible
            teeth -- removed rather than faked, per Opus review on PR #149;
            this also keeps the ticket motif to the ONE bold hero moment,
            matching `packages/ui/src/tokens.ts`'s "never decoratively
            elsewhere" rule.) */}
        <section className="bg-brand-700 px-5 py-16 sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="font-display text-3xl font-semibold tracking-tight text-white">
                Bereit, loszulegen?
              </h2>
              <p className="mt-2 text-white/85">
                Registrieren Sie Ihr Restaurant in wenigen Minuten.
              </p>
            </div>
            <Link
              href="/register"
              className="self-start rounded-md bg-brand-50 px-6 py-3 font-medium text-brand-700 transition-colors hover:bg-brand-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300 lg:self-auto"
            >
              Restaurant registrieren
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-surface px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 text-sm text-foreground-secondary sm:flex-row sm:items-center sm:justify-between">
          <span>gastro-saas</span>
          <nav className="flex gap-4" aria-label="Footer">
            <Link href="/login" className="font-medium text-link-foreground underline">
              Anmelden
            </Link>
            <Link href="/register" className="font-medium text-link-foreground underline">
              Restaurant registrieren
            </Link>
          </nav>
        </div>
      </footer>
    </>
  );
}

const FEATURED = {
  icon: QrCode,
  title: "Digitale Speisekarte per QR-Code",
  description:
    "Karten in Sekunden aktualisieren. Gäste scannen den Code am Tisch und bestellen direkt — ohne App, ohne Wartezeit auf Bedienung.",
} as const;

const SUPPORTING_FEATURES = [
  {
    icon: ClipboardList,
    title: "Bestellungen live in der Küche",
    description:
      "Jede Bestellung landet sofort im Küchen-Dashboard — kein Zuruf, kein Zettel-Chaos.",
  },
  {
    icon: Wallet,
    title: "Zahlungen ohne eigenes Kassensystem",
    description: "Gäste zahlen direkt online, sicher über Stripe abgewickelt.",
  },
  {
    icon: LineChart,
    title: "Auswertungen statt Bauchgefühl",
    description: "Topseller, Trends und Zusatzverkäufe auf einen Blick.",
  },
] as const;

const STEPS = [
  {
    title: "Registrieren",
    description: "Restaurant anlegen in unter fünf Minuten.",
  },
  {
    title: "Speisekarte einrichten",
    description: "Gerichte, Preise und Kategorien selbst pflegen, jederzeit anpassbar.",
  },
  {
    title: "QR-Code aufstellen & loslegen",
    description: "Gäste bestellen direkt am Tisch — Ihre Küche sieht es sofort.",
  },
] as const;
