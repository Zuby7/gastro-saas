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
      "Zählt anonyme Speisekarten-Aufrufe (ohne Personenbezug, nur ein Hash wird gespeichert).",
    duration: "24 Stunden",
    provider: "Diese Website (Erstanbieter)",
    category: "statistics",
  },
];

export const NECESSARY_COOKIES = COOKIE_INVENTORY.filter((c) => c.category === "necessary");
export const STATISTICS_COOKIES = COOKIE_INVENTORY.filter((c) => c.category === "statistics");

/** Third-party service reached only on explicit user action; not a cookie of this site. */
export const STRIPE_NOTICE =
  "Bei Kartenzahlung werden Sie zu Stripe (checkout.stripe.com) weitergeleitet. Dort setzt Stripe als eigener Verantwortlicher eigene Cookies und verarbeitet Zahlungsdaten nach seiner Datenschutzerklärung. Wir speichern keine Kartendaten.";
