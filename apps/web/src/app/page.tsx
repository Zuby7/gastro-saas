/* eslint-disable @next/next/no-img-element -- plain <img> on purpose: Cloudflare Workers deployment, no next/image (see docs/design/landing-assets.md) */
import Link from "next/link";
import { Clock, EyeOff, FileText, ShieldCheck, Accessibility, Star, Building2 } from "lucide-react";
import { PlatformCookieLink } from "@/lib/consent/platform-cookie-link";
import { HoloCard } from "./_landing/holo-card";
import {
  BRAND_NAME,
  CHALLENGES,
  DEMO_HREF,
  FAQS,
  FEATURES,
  LOGIN_HREF,
  PAYMENT_METHODS,
  REGISTER_HREF,
  STEPS,
  VALUES,
} from "./_landing/content";
import "./landing.css";

/**
 * Marketing landing page, modern SaaS style (issue #196): colored gradient
 * header bar, huge display headings, blurred colour glows behind sections,
 * holographic conic-gradient card borders, glass surfaces, floating phone
 * mockups and a large dashboard mockup overlapping a gradient band.
 *
 * Server component. The only client code is the tiny `HoloCard` pointer
 * glare wrapper. All colors are design tokens (see `landing.css` and the
 * `--lp-*` variables in `globals.css`); all motion is gated behind
 * `prefers-reduced-motion: no-preference` in `landing.css`. Screenshots live
 * in `public/landing/` and are mapped to roles in `docs/design/landing-assets.md`.
 */

const IMG = "/landing";

const BTN =
  "inline-flex items-center justify-center rounded-full px-6 py-3 text-base font-semibold";

const H2 = "text-4xl font-bold leading-[1.08] tracking-tight text-foreground sm:text-5xl";

export default function Home() {
  return (
    <>
      <a
        href="#inhalt"
        className="lp-skip lp-focus-ink rounded-md bg-surface px-4 py-2 font-medium text-foreground"
      >
        Zum Inhalt springen
      </a>

      <header className="lp-bar sticky top-0 z-40 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-8">
          <Link
            href="/"
            className="lp-focus rounded-md text-xl font-bold tracking-tight text-white"
          >
            {BRAND_NAME}
          </Link>
          <nav className="flex items-center gap-2 text-sm sm:gap-3" aria-label="Hauptnavigation">
            <Link
              href={LOGIN_HREF}
              className="lp-focus rounded-full border border-white/40 bg-white/12 px-4 py-2 font-medium text-white transition-colors hover:bg-white/20"
            >
              Login
            </Link>
            <Link
              href={REGISTER_HREF}
              className="lp-focus rounded-full bg-brand-50 px-4 py-2 font-semibold text-brand-800 transition-colors hover:bg-brand-100"
            >
              Registrieren
            </Link>
          </nav>
        </div>
      </header>

      <main id="inhalt">
        {/* Hero */}
        <section className="relative overflow-hidden px-5 pb-20 pt-14 sm:px-8 sm:pb-28 sm:pt-20">
          <div aria-hidden="true">
            <div className="lp-glow lp-glow--brand -left-24 -top-24 h-[28rem] w-[28rem]" />
            <div className="lp-glow lp-glow--ember -right-20 top-10 h-[30rem] w-[30rem]" />
            <div className="lp-glow lp-glow--gold bottom-0 left-1/3 h-80 w-80" />
          </div>

          <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.1fr_1fr]">
            <div className="flex flex-col items-start gap-7">
              <p className="lp-holo-ring inline-flex rounded-full px-4 py-1.5 text-sm font-medium text-foreground">
                Pilotphase, Zahlungen im Testmodus
              </p>
              <h1 className="text-5xl font-bold leading-[1.04] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
                Speisekarte, Bestellung und Zahlung{" "}
                <span className="lp-text-gradient">in einem System</span>
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-lp-muted sm:text-xl">
                Gäste scannen den QR-Code am Tisch, bestellen und bezahlen online. Sie behalten
                Bestellungen, Auswertungen und Bewertungen im Restaurant-Dashboard im Blick.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href={DEMO_HREF} className={`${BTN} lp-btn-glow lp-focus-ink`}>
                  Live-Demo ansehen
                </Link>
                <Link
                  href={REGISTER_HREF}
                  className={`${BTN} lp-glass lp-focus-ink text-foreground transition-colors hover:bg-surface`}
                >
                  Restaurant registrieren
                </Link>
              </div>
            </div>

            <div className="relative mx-auto h-[26rem] w-full max-w-md sm:h-[34rem]">
              <div className="absolute left-0 top-14 z-10 w-[9.5rem] -rotate-6 sm:w-[11.5rem]">
                <div className="lp-float lp-float--delay">
                  <div className="lp-phone overflow-hidden rounded-[1.8rem] bg-espresso-900">
                    <img
                      src={`${IMG}/hero-phone-cart.webp`}
                      width={390}
                      height={844}
                      alt="Warenkorb der digitalen Speisekarte auf dem Smartphone"
                      decoding="async"
                      className="block h-auto w-full"
                    />
                  </div>
                </div>
              </div>
              <div className="absolute left-1/2 top-0 z-20 w-[11rem] -translate-x-1/2 sm:w-[14rem]">
                <div className="lp-float">
                  <div className="lp-phone overflow-hidden rounded-[2.2rem] bg-espresso-900">
                    <img
                      src={`${IMG}/hero-phone-menu.webp`}
                      width={390}
                      height={844}
                      alt="Digitale Speisekarte einer Trattoria auf dem Smartphone"
                      decoding="async"
                      fetchPriority="high"
                      className="block h-auto w-full"
                    />
                  </div>
                </div>
              </div>
              <div className="absolute right-0 top-24 z-10 w-[9.5rem] rotate-6 sm:w-[11.5rem]">
                <div className="lp-float lp-float--delay">
                  <div className="lp-phone overflow-hidden rounded-[1.8rem] bg-espresso-900">
                    <img
                      src={`${IMG}/hero-phone-status.webp`}
                      width={390}
                      height={844}
                      alt="Bestellstatus einer Bestellung auf dem Smartphone"
                      decoding="async"
                      className="block h-auto w-full"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Herausforderung */}
        <section
          className="relative overflow-hidden px-5 py-16 sm:px-8 sm:py-24"
          aria-labelledby="herausforderung"
        >
          <div aria-hidden="true">
            <div className="lp-glow lp-glow--ember -left-24 top-1/3 h-96 w-96" />
          </div>
          <div className="relative z-10 mx-auto max-w-6xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-lp-accent">
              Herausforderung
            </p>
            <h2 id="herausforderung" className={`${H2} mt-3 max-w-3xl`}>
              Der Alltag im Service lässt viel <span className="lp-text-gradient">Zeit liegen</span>
            </h2>
            <ul className="mt-12 grid gap-6 md:grid-cols-3">
              {CHALLENGES.map((item, index) => {
                const Icon = [FileText, Clock, EyeOff][index]!;
                return (
                  <li key={item.title} className="lp-glass rounded-3xl p-7">
                    <span className="lp-holo-ring flex h-12 w-12 items-center justify-center rounded-2xl text-link-foreground">
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </span>
                    <h3 className="mt-5 text-xl font-bold tracking-tight text-foreground">
                      {item.title}
                    </h3>
                    <p className="mt-2 leading-relaxed text-lp-muted">{item.description}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Produkt-Showcase */}
        <section
          className="relative overflow-hidden px-5 pb-24 pt-8 sm:px-8 sm:pb-32"
          aria-labelledby="showcase"
        >
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-lp-accent">
              Das Restaurant-Dashboard
            </p>
            <h2 id="showcase" className={`${H2} mt-3 max-w-3xl`}>
              Ihr Restaurant <span className="lp-text-gradient">auf einen Blick</span>
            </h2>

            <div className="relative mt-12">
              <div
                aria-hidden="true"
                className="lp-band absolute -inset-x-3 bottom-[-2.5rem] top-24 rounded-[2.5rem] sm:-inset-x-6"
              />
              <div className="relative z-10 mx-auto max-w-5xl px-2 sm:px-8">
                <div className="overflow-hidden rounded-3xl border border-neutral-200 bg-surface shadow-[0_40px_90px_-30px_var(--lp-shadow)]">
                  <div
                    aria-hidden="true"
                    className="flex items-center gap-2 border-b border-neutral-200 bg-surface-secondary px-4 py-3"
                  >
                    <span className="h-3 w-3 rounded-full bg-ember-300" />
                    <span className="h-3 w-3 rounded-full bg-gold-300" />
                    <span className="h-3 w-3 rounded-full bg-brand-300" />
                  </div>
                  <img
                    src={`${IMG}/showcase-dashboard.webp`}
                    width={1280}
                    height={800}
                    alt={`Bestell-Dashboard von ${BRAND_NAME} mit den Spalten Neu, Angenommen, In Zubereitung, Fertig, Abgeschlossen und Storniert`}
                    loading="lazy"
                    decoding="async"
                    className="block h-auto w-full"
                  />
                </div>
                <HoloCard className="absolute -bottom-10 right-0 hidden w-72 overflow-hidden rounded-2xl sm:block lg:-right-6 lg:w-80">
                  <img
                    src={`${IMG}/showcase-analytics.webp`}
                    width={640}
                    height={400}
                    alt="Analytics-Ansicht mit Kennzahlen zu Umsatz und beliebten Gerichten"
                    loading="lazy"
                    decoding="async"
                    className="block h-auto w-full"
                  />
                </HoloCard>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section
          className="relative overflow-hidden px-5 py-16 sm:px-8 sm:py-24"
          aria-labelledby="funktionen"
        >
          <div aria-hidden="true">
            <div className="lp-glow lp-glow--brand -right-24 top-0 h-[30rem] w-[30rem]" />
            <div className="lp-glow lp-glow--gold -left-24 bottom-0 h-80 w-80" />
          </div>
          <div className="relative z-10 mx-auto max-w-6xl">
            <h2 id="funktionen" className={`${H2} max-w-3xl`}>
              Alles, was der Betrieb braucht, <span className="lp-text-gradient">an einem Ort</span>
            </h2>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((feature) => (
                <HoloCard key={feature.title} className="flex flex-col rounded-3xl p-4">
                  <img
                    src={`${IMG}/${feature.image}`}
                    width={feature.width}
                    height={feature.height}
                    alt={feature.alt}
                    loading="lazy"
                    decoding="async"
                    className="block h-auto w-full rounded-2xl border border-neutral-200 object-cover"
                  />
                  <div className="px-2 pb-3 pt-5">
                    <p className="text-xs font-bold uppercase tracking-widest text-lp-accent">
                      {feature.eyebrow}
                    </p>
                    <h3 className="mt-2 text-xl font-bold tracking-tight text-foreground">
                      {feature.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-lp-muted">
                      {feature.description}
                    </p>
                  </div>
                </HoloCard>
              ))}
            </div>
          </div>
        </section>

        {/* Zahlarten */}
        <section
          className="relative overflow-hidden px-5 py-16 sm:px-8 sm:py-20"
          aria-labelledby="zahlarten"
        >
          <div aria-hidden="true">
            <div className="lp-glow lp-glow--ember left-1/2 top-0 h-80 w-[36rem] -translate-x-1/2" />
          </div>
          <div className="relative z-10 mx-auto max-w-4xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-lp-accent">
              Bezahlen
            </p>
            <h2 id="zahlarten" className={`${H2} mt-3`}>
              Zahlen, wie Ihre Gäste es <span className="lp-text-gradient">gewohnt sind</span>
            </h2>
            <ul className="mt-10 flex flex-wrap justify-center gap-3" aria-label="Zahlungsarten">
              {PAYMENT_METHODS.map((method) => (
                <li
                  key={method}
                  className="lp-holo-ring rounded-full px-6 py-2.5 text-base font-semibold text-foreground"
                >
                  {method}
                </li>
              ))}
            </ul>
            <p className="lp-glass mx-auto mt-8 max-w-2xl rounded-2xl px-5 py-4 text-lp-muted">
              <strong className="font-semibold text-foreground">Pilotphase / Testmodus:</strong> Die
              Abwicklung läuft über Stripe, derzeit ausschließlich im Testmodus. Es werden keine
              echten Beträge abgebucht.
            </p>
          </div>
        </section>

        {/* Schritte */}
        <section className="px-5 py-16 sm:px-8 sm:py-24" aria-labelledby="schritte">
          <div className="mx-auto max-w-6xl">
            <h2 id="schritte" className={`${H2} max-w-3xl`}>
              In drei Schritten <span className="lp-text-gradient">startklar</span>
            </h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.title}>
                  <div aria-hidden="true" className="lp-bar h-1 w-full rounded-full" />
                  <span
                    aria-hidden="true"
                    className="lp-text-gradient mt-6 block text-7xl font-bold leading-none tracking-tight"
                  >
                    {step.number}
                  </span>
                  <h3 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-2 leading-relaxed text-lp-muted">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Werte */}
        <section
          className="relative overflow-hidden px-5 py-16 sm:px-8 sm:py-20"
          aria-labelledby="werte"
        >
          <div aria-hidden="true">
            <div className="lp-glow lp-glow--brand -left-20 top-10 h-96 w-96" />
            <div className="lp-glow lp-glow--ember -right-24 bottom-0 h-96 w-96" />
          </div>
          <div className="relative z-10 mx-auto max-w-6xl">
            <h2 id="werte" className={`${H2} max-w-3xl`}>
              Gebaut für <span className="lp-text-gradient">Gäste und Gastgeber</span>
            </h2>
            <ul className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {VALUES.map((value, index) => {
                const Icon = [ShieldCheck, Accessibility, Star, Building2][index]!;
                return (
                  <li key={value.title} className="lp-glass rounded-3xl p-6">
                    <Icon className="h-7 w-7 text-link-foreground" aria-hidden="true" />
                    <h3 className="mt-4 text-lg font-bold tracking-tight text-foreground">
                      {value.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-lp-muted">
                      {value.description}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* CTA-Band */}
        <section className="px-5 py-10 sm:px-8" aria-labelledby="cta-band">
          <div className="lp-band relative mx-auto max-w-6xl overflow-hidden rounded-[2.5rem] px-6 py-14 text-center text-white sm:px-12 sm:py-20">
            <h2
              id="cta-band"
              className="mx-auto max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-5xl"
            >
              Bereit für Ihre digitale Speisekarte?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-white/90">
              Registrieren Sie Ihr Restaurant oder sehen Sie sich zuerst die Demo an.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link
                href={REGISTER_HREF}
                className={`${BTN} lp-focus bg-brand-50 text-brand-800 shadow-[0_0_36px_-4px_var(--color-brand-200)] transition-colors hover:bg-brand-100`}
              >
                Restaurant registrieren
              </Link>
              <Link
                href={DEMO_HREF}
                className={`${BTN} lp-focus border border-white/50 bg-white/12 text-white transition-colors hover:bg-white/20`}
              >
                Live-Demo ansehen
              </Link>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="px-5 py-16 sm:px-8 sm:py-24" aria-labelledby="faq">
          <div className="mx-auto max-w-3xl">
            <h2 id="faq" className={`${H2} text-center`}>
              Häufige <span className="lp-text-gradient">Fragen</span>
            </h2>
            <div className="lp-faq mt-10 flex flex-col gap-3">
              {FAQS.map((faq) => (
                <details key={faq.question} className="lp-glass rounded-2xl">
                  <summary className="lp-focus-ink flex cursor-pointer items-center justify-between gap-4 rounded-2xl p-5 text-lg font-semibold text-foreground">
                    {faq.question}
                  </summary>
                  <p className="px-5 pb-5 leading-relaxed text-lp-muted">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Kontakt / CTA */}
        <section
          className="relative overflow-hidden px-5 pb-24 pt-4 sm:px-8"
          aria-labelledby="kontakt"
        >
          <div aria-hidden="true">
            <div className="lp-glow lp-glow--gold left-1/2 top-0 h-72 w-[34rem] -translate-x-1/2" />
          </div>
          <div className="relative z-10 mx-auto max-w-3xl text-center">
            <h2
              id="kontakt"
              className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
            >
              Noch unsicher?
            </h2>
            <p className="mt-3 text-lg text-lp-muted">
              Probieren Sie die Live-Demo aus oder melden Sie sich an, wenn Sie bereits ein Konto
              haben.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link href={DEMO_HREF} className={`${BTN} lp-btn-glow lp-focus-ink`}>
                Live-Demo ansehen
              </Link>
              <Link
                href={LOGIN_HREF}
                className={`${BTN} lp-glass lp-focus-ink text-foreground transition-colors hover:bg-surface`}
              >
                Login
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-surface px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 text-sm text-foreground-secondary sm:flex-row sm:items-center sm:justify-between">
          <span>{BRAND_NAME}, Pilotphase (Testmodus)</span>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Footer">
            <Link
              href={LOGIN_HREF}
              className="lp-focus-ink font-medium text-link-foreground underline"
            >
              Login
            </Link>
            <Link
              href={REGISTER_HREF}
              className="lp-focus-ink font-medium text-link-foreground underline"
            >
              Restaurant registrieren
            </Link>
            <Link
              href={DEMO_HREF}
              className="lp-focus-ink font-medium text-link-foreground underline"
            >
              Live-Demo ansehen
            </Link>
            <Link
              href="/datenschutz"
              className="lp-focus-ink font-medium text-link-foreground underline"
            >
              Datenschutz
            </Link>
            <PlatformCookieLink />
          </nav>
        </div>
      </footer>
    </>
  );
}
