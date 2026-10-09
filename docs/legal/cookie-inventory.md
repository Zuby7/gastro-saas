# Cookie-Inventar und Einwilligungsverwaltung

Stand: Ticket #162. **Dies ist keine Rechtsberatung und keine Konformitätszusage.** Vor dem Produktivbetrieb wird eine Prüfung durch eine Kanzlei bzw. Datenschutzberatung empfohlen (Rechtsgrundlagen: § 25 TDDDG, Art. 6/7 DSGVO; Orientierung: EuGH C-673/17 Planet49, BGH I ZR 7/16, DSK-Orientierungshilfe Telemedien).

## Pflegeregel

**Jedes neue Cookie oder Skript (auch Drittanbieter, localStorage, Pixel) bedeutet im selben PR: Inventar (`apps/web/src/lib/consent/inventory.ts`) + Banner/Einstellungs-Dialog + Datenschutzerklärung.** Dialog und Datenschutzseite rendern beide die typisierte Konstante `COOKIE_INVENTORY`, sie können daher nicht auseinanderlaufen. `inventory.test.ts` schlägt fehl, wenn im Code ein `gastro_*`-Cookie gesetzt wird, das nicht im Inventar steht, oder wenn ein neues Modul Cookies schreibt. Bei wesentlichen Änderungen `CONSENT_VERSION` (`apps/web/src/lib/consent/cookie.ts`) erhöhen, damit alle Besucher erneut gefragt werden.

## Inventar (Stand Code)

| Name                           | Zweck                                                                                  | Kategorie                               | Dauer                                   | Einwilligung                        | Quelle im Code                            |
| ------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------- | ----------------------------------- | ----------------------------------------- |
| `gastro_cookie_consent`        | speichert die Entscheidung `{version, timestamp, statistics}`                          | notwendig                               | 6 Monate                                | nein                                | `lib/consent/cookie.ts`                   |
| `gastro_cart_<slug>`           | Warenkorb des Gasts je Restaurant (httpOnly)                                           | notwendig                               | 14 Tage                                 | nein                                | `lib/cart/cookie.ts`                      |
| `gastro_order_<slug>`          | Zugriff auf die eigene Bestellung (httpOnly)                                           | notwendig                               | 3 Tage                                  | nein                                | `lib/orders/cookie.ts`                    |
| `sb-*`                         | Supabase-Auth-Sitzung (Personal/Kundenkonto, httpOnly)                                 | notwendig                               | bis 400 Tage (Standard `@supabase/ssr`) | nein                                | `lib/supabase/server.ts`, `middleware.ts` |
| `gastro_view_<slug>`           | anonyme Speisekartenaufrufe zählen (#67), nur SHA-256-Hash wird gespeichert (httpOnly) | Statistik                               | 24 Stunden                              | **ja (Opt-in)**                     | `middleware.ts`, `lib/menu-view/`         |
| Stripe (`checkout.stripe.com`) | Kartenzahlung                                                                          | Drittanbieter, eigener Verantwortlicher | nach Stripe                             | Hinweis in der Datenschutzerklärung | Weiterleitung, kein Cookie dieser Seite   |

Hinweis zur Abweichung vom Ticketentwurf: die Warenkorb- und Bestell-Cookies heißen im Code `gastro_cart_<slug>` / `gastro_order_<slug>` (nicht `cart-<slug>`/`order-<slug>`).

Schriften werden self-hosted (`next/font`), kein Google-Fonts-Request. Keine Marketing-/Tracking-Skripte.

## Einwilligung

- Erste Ebene: drei gleichwertige Schaltflächen (identische Klassen, `CONSENT_BUTTON_CLASS`): „Alle ablehnen“, „Einstellungen“, „Alle akzeptieren“. Schließen/Weiterscrollen/ESC gilt nie als Zustimmung.
- Einstellungs-Dialog: Kategorie „Notwendig“ (immer aktiv) und „Statistik“ (Opt-in, standardmäßig aus), je mit Tabelle Name/Zweck/Dauer/Anbieter.
- Speicherung: Cookie `gastro_cookie_consent` mit URL-codiertem JSON `{version, timestamp, statistics}`. Das ist der Nachweis (Art. 7 Abs. 1 DSGVO) ohne zusätzliche personenbezogene Daten; es gibt bewusst kein serverseitiges Consent-Log (Datensparsamkeit, keine IP-Adressen).
- Re-Prompt: bei anderer `CONSENT_VERSION`, nach 6 Monaten, bei unlesbarem/zukünftigem Zeitstempel. Alte Werte `accepted`/`declined` (Ticket #146) gelten als veraltet; bis zur neuen Entscheidung ist Statistik aus.
- Widerruf: Link „Cookie-Einstellungen“ auf allen öffentlichen Restaurantseiten (`apps/web/src/app/r/[slug]/layout.tsx`). Speichern mit abgewähltem „Statistik“ löscht `gastro_view_*` (Middleware auf jeder Route, da das Cookie httpOnly ist).
- Middleware mintet `gastro_view_<slug>` nur bei gültiger, aktueller Entscheidung mit `statistics: true`.

## Offene Punkte für die externe Rechtsprüfung

- Rechtsgrundlagen-Formulierungen in der Datenschutzerklärung (Plattform-Abschnitt) und Rollenverteilung Plattform/Restaurant (Verantwortlicher, AV-Vertrag).
- Einstufung von `gastro_order_<slug>` und `sb-*` als „unbedingt erforderlich“ (§ 25 Abs. 2 Nr. 2 TDDDG) und der Einsatz des Statistik-Cookies (§ 25 Abs. 1 TDDDG).
- Angemessenheit der 6-Monats-Frist und des Banner-Wortlauts.
