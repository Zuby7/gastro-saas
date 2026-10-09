"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  parseConsent,
  serializeConsent,
  type ConsentState,
} from "@/lib/consent/cookie";
import { CookieTable } from "@/lib/consent/cookie-table";
import {
  NECESSARY_COOKIES,
  STATISTICS_COOKIES,
  STATISTICS_DESCRIPTION,
} from "@/lib/consent/inventory";

/**
 * Tickets #146/#162: cookie-consent UI for the public restaurant pages.
 *
 * - First level: three visually identical buttons (reject all / settings /
 *   accept all). Closing or scrolling never counts as consent -- the banner
 *   simply stays until an explicit choice is made.
 * - Settings dialog: category "Notwendig" (always on) and "Statistik"
 *   (opt-in, default off), each with a Name/Zweck/Dauer/Anbieter table from
 *   the shared inventory (`@/lib/consent/inventory`).
 * - A persistent "Cookie-Einstellungen" link (rendered by the `[slug]`
 *   layout on every public page) reopens the dialog; saving "statistics off"
 *   is the withdrawal, and the refreshed request makes middleware delete the
 *   (httpOnly) `gastro_view_*` cookie.
 *
 * The decision is written client-side via `document.cookie` (versioned JSON,
 * see `@/lib/consent/cookie`) so it applies immediately; `router.refresh()`
 * then re-runs middleware with the fresh decision.
 */

/** One class string for all three first-level buttons: equal size, weight and contrast. */
export const CONSENT_BUTTON_CLASS =
  "rounded-md border-2 border-foreground bg-surface px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-link-foreground";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function readConsentCookie(): string | null {
  const entry = document.cookie
    .split("; ")
    .find((candidate) => candidate.startsWith(`${CONSENT_COOKIE_NAME}=`));
  return entry ? entry.slice(CONSENT_COOKIE_NAME.length + 1) : null;
}

export function CookieConsentBanner({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  // Starts as null (identical on server and client) and is filled in a
  // post-mount effect once `document.cookie` is readable, avoiding a
  // hydration mismatch. Genuine "synchronize with an external system" effect.
  const [consent, setConsent] = useState<ConsentState | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statistics, setStatistics] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const settingsLinkRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const [bannerHeight, setBannerHeight] = useState(0);
  const titleId = useId();
  const statisticsId = useId();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only cookie read, not derivable during SSR/first render.
    setConsent(parseConsent(readConsentCookie()));
  }, []);

  useEffect(() => {
    if (dialogOpen) {
      dialogRef.current?.focus();
    }
  }, [dialogOpen]);

  const bannerVisible = consent !== null && consent.status !== "valid";

  // The banner is fixed at the bottom; reserve exactly its height in the page
  // flow while it is visible so it never covers content (notably on mobile,
  // where it is tall), and release the space as soon as a decision is made.
  useEffect(() => {
    const element = bannerRef.current;
    if (!bannerVisible || !element) {
      setBannerHeight(0);
      return;
    }
    const measure = () => setBannerHeight(element.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bannerVisible]);

  function openDialog(trigger?: HTMLElement | null) {
    returnFocusRef.current = trigger ?? (document.activeElement as HTMLElement | null);
    const current = parseConsent(readConsentCookie());
    // Default is always "off"; only a valid earlier opt-in pre-selects it.
    setStatistics(current.status === "valid" && current.record.statistics);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    // Wait for the dialog to unmount, then restore focus to the trigger.
    window.setTimeout(() => {
      // Trigger may be gone (banner closes after a decision): fall back to the
      // persistent settings link so focus is never lost to <body>.
      const fallback = settingsLinkRef.current;
      if (target && target.isConnected) {
        target.focus();
      } else if (fallback) {
        fallback.focus();
      }
    }, 0);
  }

  function decide(statisticsChoice: boolean) {
    // `secure` only over https -- a local http origin must still be able to
    // write the cookie (`document.cookie` silently drops secure cookies there).
    const secureAttr = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${CONSENT_COOKIE_NAME}=${serializeConsent(statisticsChoice)}; path=/; max-age=${CONSENT_COOKIE_MAX_AGE_SECONDS}; samesite=lax${secureAttr}`;
    setConsent(parseConsent(readConsentCookie()));
    if (dialogOpen) {
      closeDialog();
    }
    router.refresh();
  }

  function onDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (!dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <footer className="border-t border-neutral-200 px-5 py-4 sm:px-8">
        <div className="mx-auto max-w-5xl text-sm">
          <button
            ref={settingsLinkRef}
            type="button"
            onClick={(event) => openDialog(event.currentTarget)}
            className="font-medium text-link-foreground underline hover:text-foreground"
          >
            Cookie-Einstellungen
          </button>
        </div>
      </footer>

      {bannerVisible ? (
        <div
          data-testid="cookie-banner-spacer"
          aria-hidden="true"
          style={{ height: bannerHeight }}
        />
      ) : null}

      {bannerVisible ? (
        <div
          ref={bannerRef}
          role="region"
          aria-label="Cookie-Hinweis"
          className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-surface p-4 shadow-[0_-4px_12px_rgba(0,0,0,.08)]"
        >
          <div className="mx-auto flex max-w-5xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm text-foreground">
              Wir setzen notwendige Cookies ein. Mit Ihrer Einwilligung setzen wir zusätzlich ein
              Statistik-Cookie, das Speisekarten-Aufrufe, Gericht-Ansichten und „In den
              Warenkorb“-Aktionen zählt (dabei wird zur Missbrauchsabwehr und Mehrfachzählung ein
              Hash Ihrer IP-Adresse verarbeitet). Sie können alles ablehnen, Ihre Auswahl in den
              Einstellungen anpassen oder alles akzeptieren. Details in unserer{" "}
              <Link
                href={`/r/${tenantSlug}/datenschutz`}
                className="font-medium text-link-foreground underline hover:text-foreground"
              >
                Datenschutzerklärung
              </Link>
              .
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" onClick={() => decide(false)} className={CONSENT_BUTTON_CLASS}>
                Alle ablehnen
              </button>
              <button
                type="button"
                onClick={(event) => openDialog(event.currentTarget)}
                className={CONSENT_BUTTON_CLASS}
              >
                Einstellungen
              </button>
              <button type="button" onClick={() => decide(true)} className={CONSENT_BUTTON_CLASS}>
                Alle akzeptieren
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dialogOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={onDialogKeyDown}
            className="flex max-h-full w-full max-w-3xl flex-col gap-5 overflow-y-auto rounded-lg bg-surface p-6 text-foreground shadow-xl focus:outline-none"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id={titleId} className="font-display text-xl font-semibold">
                Cookie-Einstellungen
              </h2>
              <button
                type="button"
                onClick={closeDialog}
                className="text-sm font-medium text-link-foreground underline hover:text-foreground"
              >
                Schließen
              </button>
            </div>
            <p className="text-sm">
              Hier legen Sie fest, welche Cookies wir setzen dürfen. Ihre Auswahl können Sie
              jederzeit über „Cookie-Einstellungen“ am Seitenende ändern oder widerrufen. Mehr in
              der{" "}
              <Link
                href={`/r/${tenantSlug}/datenschutz`}
                className="font-medium text-link-foreground underline hover:text-foreground"
              >
                Datenschutzerklärung
              </Link>
              .
            </p>

            <section aria-labelledby={`${titleId}-necessary`} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4">
                <h3 id={`${titleId}-necessary`} className="font-semibold">
                  Notwendig
                </h3>
                <span className="text-sm font-medium">Immer aktiv</span>
              </div>
              <p className="text-sm">
                Diese Cookies sind für den Betrieb der Seite erforderlich (Warenkorb, Bestellung,
                Anmeldung, Speicherung Ihrer Cookie-Auswahl) und können nicht abgewählt werden.
              </p>
              <CookieTable cookies={NECESSARY_COOKIES} caption="Notwendige Cookies" />
            </section>

            <section aria-labelledby={`${titleId}-statistics`} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4">
                <h3 id={`${titleId}-statistics`} className="font-semibold">
                  Statistik
                </h3>
                <label
                  htmlFor={statisticsId}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <input
                    id={statisticsId}
                    type="checkbox"
                    checked={statistics}
                    onChange={(event) => setStatistics(event.target.checked)}
                    className="h-5 w-5 accent-brand-600"
                  />
                  Statistik erlauben
                </label>
              </div>
              <p className="text-sm">
                {STATISTICS_DESCRIPTION} Nur mit Ihrer Einwilligung, standardmäßig aus.
              </p>
              <CookieTable cookies={STATISTICS_COOKIES} caption="Statistik-Cookies" />
            </section>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => decide(false)} className={CONSENT_BUTTON_CLASS}>
                Alle ablehnen
              </button>
              <button
                type="button"
                onClick={() => decide(statistics)}
                className={CONSENT_BUTTON_CLASS}
              >
                Auswahl speichern
              </button>
              <button type="button" onClick={() => decide(true)} className={CONSENT_BUTTON_CLASS}>
                Alle akzeptieren
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
