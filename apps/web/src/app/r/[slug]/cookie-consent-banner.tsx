"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONSENT_COOKIE_MAX_AGE_SECONDS,
  CONSENT_COOKIE_NAME,
  type ConsentValue,
} from "@/lib/consent/cookie";

/**
 * Ticket #146: minimal, dismissible cookie-consent banner gating the
 * `menu_view` analytics cookie (ticket #67) -- the only non-essential
 * cookie this app currently sets (Supabase auth and cart/order cookies are
 * strictly necessary and are never gated). Deliberately simple: two
 * buttons, no cookie category matrix/CMP.
 *
 * The consent decision itself is stored in a first-party cookie
 * (`gastro_cookie_consent`) that is itself essential (it only remembers the
 * visitor's own preference) and therefore requires no consent to set.
 *
 * Written client-side via `document.cookie` (not a server action) so the
 * decision takes effect immediately without a full page reload; `router.
 * refresh()` re-runs the Server Component tree (including middleware) on
 * the next request so the analytics cookie is minted (or stays absent) per
 * the fresh decision.
 */
export function CookieConsentBanner({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();
  // Starts hidden (identical on server and client) and is only revealed in a
  // post-mount effect once `document.cookie` is actually readable -- a lazy
  // `useState` initializer still runs during SSR, where no cookie can be
  // read, so computing it there would risk a hydration mismatch for anyone
  // who already made a decision on a previous visit. This is a genuine
  // "synchronize with an external system" (the browser's cookie jar) effect,
  // exempted from `react-hooks/set-state-in-effect` below -- same rationale
  // as `../../account/orders/[orderId]/refund-form.tsx`'s token mint.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hasDecision = document.cookie
      .split("; ")
      .some((entry) => entry.startsWith(`${CONSENT_COOKIE_NAME}=`));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above: client-only cookie read, not derivable during SSR/first render.
    setVisible(!hasDecision);
  }, []);

  function decide(value: ConsentValue) {
    // `secure` is appended only over https -- a local/preview http origin
    // (e.g. `wrangler dev`) must still be able to write the cookie, and
    // `document.cookie` silently drops a `secure` cookie set from a
    // non-secure context rather than erroring.
    const secureAttr = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${CONSENT_COOKIE_NAME}=${value}; path=/; max-age=${CONSENT_COOKIE_MAX_AGE_SECONDS}; samesite=lax${secureAttr}`;
    setVisible(false);
    router.refresh();
  }

  if (!visible) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Cookie-Einstellungen"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-surface p-4 shadow-[0_-4px_12px_rgba(0,0,0,.08)]"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground">
          Wir verwenden ein nicht-essenzielles Cookie, um anonyme Seitenaufrufe für dieses
          Restaurant zu zählen. Details in unserer{" "}
          <Link
            href={`/r/${tenantSlug}/datenschutz`}
            className="font-medium text-link-foreground underline hover:text-brand-700"
          >
            Datenschutzerklärung
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide("declined")}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            Ablehnen
          </button>
          <button
            type="button"
            onClick={() => decide("accepted")}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            Akzeptieren
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Ticket #146 Opus repair-cycle finding: withdrawing consent must be as easy
 * as giving it, not just a one-time banner. A plain footer link that clears
 * the decision cookie and reloads -- the reload re-runs middleware (which
 * then also clears the now-unconsented `menu_view` cookie, see
 * `middleware.ts`) and remounts `CookieConsentBanner`, whose own effect
 * re-detects the missing decision cookie and shows the banner again.
 */
export function CookieSettingsLink() {
  function resetConsent() {
    document.cookie = `${CONSENT_COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
    window.location.reload();
  }

  return (
    <button
      type="button"
      onClick={resetConsent}
      className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
    >
      Cookie-Einstellungen
    </button>
  );
}
