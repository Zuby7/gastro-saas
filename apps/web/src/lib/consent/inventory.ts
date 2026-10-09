/**
 * Single source of truth for the cookie inventory (ticket #162). Used by the
 * consent settings dialog and the Datenschutz page so they cannot drift, and
 * checked against the code by `inventory.test.ts`. Maintenance rule: a new
 * cookie/script means inventory + banner + Datenschutz in the same PR (see
 * `docs/legal/cookie-inventory.md`). Not legal advice.
 */
export type CookieCategory = "necessary" | "statistics";

export interface CookieInventoryEntry {
  /** Cookie name; `<slug>` is replaced by the restaurant's URL slug. */
  name: string;
  purpose: string;
  duration: string;
  provider: string;
  category: CookieCategory;
}

export const COOKIE_INVENTORY: readonly CookieInventoryEntry[] = [
  {
    name: "gastro_cookie_consent",
    purpose: "Speichert Ihre Cookie-Entscheidung (Version, Zeitpunkt, Auswahl).",
    duration: "6 Monate",
    provider: "Diese Website (Erstanbieter)",
    category: "necessary",
  },
  {
    name: "gastro_cart_<slug>",
    purpose: "Merkt sich den Warenkorb des Restaurants, in dem Sie bestellen.",
    duration: "14 Tage",
    provider: "Diese Website (Erstanbieter)",
    category: "necessary",
  },
  {
    name: "gastro_order_<slug>",
    purpose: "Ermöglicht den Zugriff auf Ihre eigene Bestellung nach dem Checkout.",
    duration: "3 Tage",
    provider: "Diese Website (Erstanbieter)",
    category: "necessary",
  },
  {
    name: "sb-*",
    purpose: "Anmeldung und Sitzung (nur für angemeldetes Personal und Kundenkonten).",
    duration: "bis zu 400 Tage (Standard von Supabase Auth)",
    provider: "Diese Website (Erstanbieter, Supabase Auth)",
    category: "necessary",
  },
  {
    name: "gastro_view_<slug>",
    purpose:
      "Enthält eine zufällige Kennung, um Speisekarten-Aufrufe, Gericht-Ansichten und „In den Warenkorb“-Aktionen je Besuch nur einmal zu zählen. Dabei wird ein Hash Ihrer IP-Adresse zur Missbrauchsabwehr (Ratenbegrenzung) und Mehrfachzählung verarbeitet.",
    duration: "24 Stunden",
    provider: "Diese Website (Erstanbieter)",
    category: "statistics",
  },
];

export const NECESSARY_COOKIES = COOKIE_INVENTORY.filter((c) => c.category === "necessary");
export const STATISTICS_COOKIES = COOKIE_INVENTORY.filter((c) => c.category === "statistics");

/**
 * Cookies that can actually occur on the platform pages outside `/r/[slug]`
 * (`/`, `/login`, `/register`, `/account`, `/datenschutz`): the Supabase auth
 * session and the consent cookie (only present if the visitor decided on a
 * restaurant page, it is scoped to `/`). No cart/order/statistics cookies.
 */
const PLATFORM_COOKIE_NAMES: readonly string[] = ["sb-*", "gastro_cookie_consent"];
export const PLATFORM_COOKIES = COOKIE_INVENTORY.filter((c) =>
  PLATFORM_COOKIE_NAMES.includes(c.name),
);

/**
 * Plain-language description of what the statistics category does; shown in
 * the settings dialog. Must stay true to `lib/menu-view/service.ts`: it counts
 * menu views, dish views and add-to-cart events, and processes a keyed
 * HMAC-SHA256 hash (server secret) of the IP address (not anonymous) for rate limiting and deduplication. The
 * hash rows are meant to be purged after 35 days (see
 * `docs/legal/cookie-inventory.md` for the open scheduling point).
 */
export const STATISTICS_DESCRIPTION =
  "Hilft dem Restaurant zu verstehen, wie oft die Speisekarte aufgerufen, einzelne Gerichte angesehen und Gerichte in den Warenkorb gelegt werden. Zur Missbrauchsabwehr und Mehrfachzählung wird ein Hash Ihrer IP-Adresse verarbeitet; er ist für eine Speicherung von höchstens 35 Tagen vorgesehen.";

/** Third-party service reached only on explicit user action; not a cookie of this site. */
export const STRIPE_NOTICE =
  "Bei Kartenzahlung werden Sie zu Stripe (checkout.stripe.com) weitergeleitet. Dort setzt Stripe als eigener Verantwortlicher eigene Cookies und verarbeitet Zahlungsdaten nach seiner Datenschutzerklärung. Wir speichern keine Kartendaten.";
