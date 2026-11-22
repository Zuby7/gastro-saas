## Hintergrund

Das Performance-Audit 2026-11 hat mehrere verifizierte Ursachen für lange Ladezeiten und einige tote Code-Stellen ergeben. Dieses Ticket behebt genau diese Befunde.

## Akzeptanzkriterien

- [ ] Gerichtsbilder: `/media/*` streamt die Bytes direkt (statt 307 auf eine 60-s-Signed-URL), mit `Content-Type`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` und ETag/304. Autorisierung und 404-Verhalten bleiben unverändert. Bilder haben feste Abmessungen, `loading`/`decoding`-Attribute; Upload begrenzt die längste Kante auf 1200 px.
- [ ] Menüseite: eine Tenant-Auflösung, Warenkorb parallel zum Menü, Analytics-Schreibzugriffe in `after()`; `loadCartViewForDisplay` ist keine Server Action mehr und legt bei einem GET keinen Warenkorb an; Menüabruf per React `cache()` geteilt; Warenkorb- und Checkout-Seite nutzen den gecachten Abruf; Rate-Limit für das Anlegen neuer Gast-Warenkörbe.
- [ ] Middleware: Supabase-Session-Refresh nur auf Routen, die eine Session lesen; `/media`, `/api/webhooks`, `/landing` und statische Dateien werden übersprungen; Consent-Cookie-Logik für `/r/*` unverändert.
- [ ] Account-Seiten: ein per `React.cache` geteilter Kontext-Helper (Nutzer + Mitgliedschaft + optionale Berechtigung) ohne Abschwächung der serverseitigen Autorisierung.
- [ ] Toter Code entfernt; die vier identischen Token-Module in `lib/security/opaque-token.ts` zusammengeführt.

## Nicht-Ziele

- Keine Migrationen, keine neuen Abhängigkeiten, kein Aufteilen großer Dateien.
- Keine Änderungen an `next.config.ts`, `public/_headers`, Zahlungs-/Webhook-/Registrierungs-Code.

## Tests

Unit-Tests für Media-Route, Middleware-Matcher, Warenkorb-Lookup, Rate-Limit und Token-Modul; Lint, Typecheck, Vitest, Build grün.
