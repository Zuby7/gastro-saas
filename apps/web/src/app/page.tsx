import Link from "next/link";
import { ClipboardList, LineChart, QrCode, Wallet } from "lucide-react";

/**
 * Marketing/landing page (visual redesign, per direct user request — "sieht
 * kacke aus"). Replaces the foundation placeholder that shipped with the
 * initial scaffold.
 *
 * Design notes (no `frontend-design` skill/plugin available in this
 * session — see `.claude/rules/frontend.md`'s note that it's optional if
 * not installed — so this follows the same two-pass discipline manually):
 *
 * Pass 1 (plan): reuse the app's existing "design pass v2" system
 * (`packages/ui/src/tokens.ts`) rather than inventing a new one for this
 * single page — `brand` green stays the only primary/interactive color,
 * `espresso` is the hero backdrop (same gradient already used on the public
 * menu hero, `r/[slug]/page.tsx`), `gold`/`brand` tints mark the "how it
 * works" steps and feature icons. Real dish photos
 * (`supabase/seed-assets/dishes/*.jpg`) were deliberately NOT used here even
 * though the ticket suggested them as an option: `ATTRIBUTION.md` in that
 * directory states they're "used here as local-dev/demo seed data only ...
 * never served as production content", and this marketing page is real
 * production content shown to prospective signups — using them here would
 * violate that documented boundary. This also matches the platform's
 * existing design rationale (see `tokens.ts`'s header comment): the
 * ticket/order-service motif was deliberately chosen to be cuisine-agnostic
 * rather than photo-of-one-cuisine, since the product serves many kinds of
 * restaurants, not just the Italian demo tenant the seed photos depict.
 *
 * Pass 2 (critique): avoids the generic-SaaS blue-gradient-hero cliché (the
 * hero uses the same warm espresso gradient as the rest of the product, not
 * a cold blue/purple gradient); avoids a wall of identical icon-in-a-circle
 * cards being the ONLY idea by pairing the feature grid with a distinct
 * "how it works" numbered-steps section and a dedicated closing CTA band;
 * keeps every accent color use restrained (ember isn't used at all here —
 * there's no "order"/"price" moment on a marketing page for it to
 * legitimately anchor, so introducing it would just be decoration; gold is
 * used only for the small step-number badges, never as a large fill).
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
        {/* Hero — same warm espresso gradient as the public menu hero (r/[slug]/page.tsx),
            deliberately reused rather than a generic blue-gradient SaaS hero. */}
        <section className="bg-gradient-to-br from-espresso-900 to-espresso-800 px-5 py-16 sm:px-8 sm:py-24">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6">
            <h1 className="max-w-3xl font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Ihr Restaurant verdient mehr als ein Kassenbuch und einen Stapel Papierkarten.
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-white/80">
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
        </section>

        {/* Features */}
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

            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((feature) => (
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
        </section>

        {/* How it works */}
        <section className="px-5 py-16 sm:px-8 sm:py-20" aria-labelledby="how-it-works-heading">
          <div className="mx-auto max-w-6xl">
            <h2
              id="how-it-works-heading"
              className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
            >
              In drei Schritten startklar
            </h2>

            <ol className="mt-10 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex flex-col gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-100 font-display text-base font-semibold text-gold-800"
                  >
                    {index + 1}
                  </span>
                  <h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-foreground-secondary">
                    {step.description}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="bg-brand-700 px-5 py-16 text-center sm:px-8 sm:py-20">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-5">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-white">
              Bereit, loszulegen?
            </h2>
            <p className="text-white/85">Registrieren Sie Ihr Restaurant in wenigen Minuten.</p>
            <Link
              href="/register"
              className="rounded-md bg-brand-50 px-6 py-3 font-medium text-brand-700 transition-colors hover:bg-brand-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-300"
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

const FEATURES = [
  {
    icon: QrCode,
    title: "Digitale Speisekarte per QR-Code",
    description:
      "Karten in Sekunden aktualisieren. Gäste scannen den Code am Tisch und bestellen direkt.",
  },
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
