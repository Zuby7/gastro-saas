import Link from "next/link";
import { notFound } from "next/navigation";
import { CookieTable } from "@/lib/consent/cookie-table";
import { NECESSARY_COOKIES, STATISTICS_COOKIES, STRIPE_NOTICE } from "@/lib/consent/inventory";
import { getPublicLegalPage } from "@/lib/public-menu/fetch";

interface DatenschutzPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Ticket #41: public Datenschutzerklärung page, linked from the checkout
 * privacy notice. Rendered as plain text only (no
 * `dangerouslySetInnerHTML`) -- see `../impressum/page.tsx`'s comment for
 * the same rationale.
 */
export default async function DatenschutzPage({ params }: DatenschutzPageProps) {
  const { slug } = await params;
  const legalPage = await getPublicLegalPage(slug, "privacy");

  if (!legalPage) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-10 sm:px-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Datenschutzerklärung: {legalPage.tenantName}
          </h1>
          <Link
            href={`/r/${slug}`}
            className="shrink-0 text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück zur Speisekarte
          </Link>
        </div>

        {legalPage.text ? (
          <p className="whitespace-pre-wrap leading-relaxed text-foreground">{legalPage.text}</p>
        ) : (
          <p className="text-foreground-secondary">
            Für dieses Restaurant wurde noch keine Datenschutzerklärung hinterlegt.
          </p>
        )}

        {/*
          Ticket #162: platform-level cookie section. Rendered from the same
          typed inventory as the consent dialog (`@/lib/consent/inventory`) so
          the two can never disagree. Not legal advice -- see
          `docs/legal/cookie-inventory.md`.
        */}
        <section aria-labelledby="cookies-heading" className="flex flex-col gap-4 text-foreground">
          <h2 id="cookies-heading" className="font-display text-xl font-semibold">
            Cookies und ähnliche Technologien
          </h2>
          <p className="leading-relaxed">
            Diese Website speichert Informationen in Ihrem Browser (Cookies). Notwendige Cookies
            setzen wir ohne Einwilligung, weil sie für den ausdrücklich gewünschten Dienst
            erforderlich sind (§ 25 Abs. 2 Nr. 2 TDDDG); die anschließende Verarbeitung stützt sich
            auf Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse am sicheren Betrieb der Seite)
            beziehungsweise, soweit es um die Bestellabwicklung geht, auf Art. 6 Abs. 1 lit. b
            DSGVO. Statistik-Cookies setzen wir nur mit Ihrer Einwilligung (§ 25 Abs. 1 TDDDG, Art.
            6 Abs. 1 lit. a DSGVO).
          </p>

          <h3 className="font-semibold">Notwendige Cookies</h3>
          <CookieTable cookies={NECESSARY_COOKIES} caption="Notwendige Cookies" />

          <h3 className="font-semibold">Statistik (nur mit Einwilligung)</h3>
          <CookieTable cookies={STATISTICS_COOKIES} caption="Statistik-Cookies" />

          <h3 className="font-semibold">Widerruf und Änderung Ihrer Auswahl</h3>
          <p className="leading-relaxed">
            Ihre Einwilligung ist freiwillig und kann jederzeit mit Wirkung für die Zukunft
            widerrufen werden: Über den Link „Cookie-Einstellungen“ am Ende jeder Seite öffnen Sie
            die Auswahl erneut; beim Widerruf wird das Statistik-Cookie gelöscht. Die Rechtmäßigkeit
            der bis dahin erfolgten Verarbeitung bleibt unberührt. Zum Nachweis Ihrer Auswahl
            speichern wir nur Version, Zeitpunkt und Auswahl in Ihrem Browser, nicht auf unseren
            Servern. Wir fragen nach spätestens 6 Monaten oder bei einer Änderung der Cookie-Liste
            erneut.
          </p>

          <h3 className="font-semibold">Zahlungsdienstleister Stripe</h3>
          <p className="leading-relaxed">{STRIPE_NOTICE}</p>

          <p className="leading-relaxed">
            Schriftarten werden von unserem eigenen Server ausgeliefert; es werden keine Daten an
            Google Fonts übermittelt. Marketing- oder Tracking-Dienste setzen wir nicht ein.
          </p>
        </section>
      </div>
    </main>
  );
}
