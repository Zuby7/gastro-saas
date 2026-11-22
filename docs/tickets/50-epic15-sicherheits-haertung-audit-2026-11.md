## Hintergrund

Das Sicherheits-Audit 2026-11 hat mehrere verifizierte Befunde ergeben. Dieses Ticket behebt genau diese Punkte, ohne weitere Umbauten.

## Umfang

1. **HTTP-Sicherheits-Header**: Aktuell werden keine gesendet. In `apps/web/next.config.ts` `poweredByHeader: false` und `headers()` für alle Routen ergänzen (HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, Content-Security-Policy mit `frame-ancestors 'none'`). Für `/r/:slug/orders/:path*` und `/invite/:path*` zusätzlich `Referrer-Policy: no-referrer` und `X-Robots-Tag: noindex, nofollow` (Bearer-Token in der URL). `apps/web/public/_headers` mit unveränderlichem Caching für `/_next/static/*`.
2. **Zahlungs-Webhook**: `apps/web/src/lib/payments/webhook-service.ts` behandelt vorübergehende Datenbankfehler wie "nicht gefunden"; das Ereignis wird als verarbeitet markiert und Stripe wiederholt es nie (bezahlte Bestellung bleibt in `awaiting_payment`). Bei Datenbankfehlern werfen (Route antwortet 5xx, Ereignis bleibt erneut beanspruchbar), `null` nur bei tatsächlich fehlender Zeile, Ergebnis des Updates in `flagPaymentForReview` prüfen. Außerdem `apps/web/src/app/account/payments/return/page.tsx` gegen `stripe_account_id = null` absichern.
3. **Enumeration bei der Registrierung**: `apps/web/src/app/register/actions.ts` verrät, ob eine E-Mail-Adresse bereits registriert ist. Gleiches neutrales Ergebnis für bestehende und neue Adressen sowie dieselbe Mindestantwortzeit wie beim Login.
4. **Checkout-Limit**: 10 Versuche pro Stunde und IP blockieren ein ganzes Restaurant im gemeinsamen WLAN. IP-Limit deutlich anheben, enges Limit je (IP, Warenkorb) beibehalten.
5. **Kleinere Punkte**:
   - `apps/web/src/app/account/orders/actions.ts`: `orderId` (UUID) und `toStatus` (Enum) mit zod validieren, keine rohen Datenbank-Fehlertexte zurückgeben.
   - `apps/web/src/app/api/qr/route.ts`: `table` validieren (max. 32 Zeichen, sicherer Zeichensatz), sonst 400.
   - Maximale Länge für `altText` beim Bild-Upload eines Gerichts.
   - `apps/web/src/lib/invitations/email.ts`: E-Mail-Adresse der eingeladenen Person nicht protokollieren.
   - Datenschutz-Export: Berechtigung auf Inhaber-Ebene verlangen statt nur `tenant.settings.write`.

## Akzeptanzkriterien

- [ ] Sicherheits-Header werden für alle Routen ausgeliefert, die Anwendung funktioniert weiterhin (Build, Tests).
- [ ] Webhook: Datenbankfehler führt zu 5xx und das Ereignis wird nicht als verarbeitet markiert; fehlende Zeile verhält sich wie bisher; Duplikate bleiben idempotent.
- [ ] Registrierung liefert für bestehende und neue E-Mail-Adressen dieselbe Antwort.
- [ ] Checkout-Limits sind angepasst und getestet.
- [ ] Alle kleineren Punkte sind umgesetzt und getestet, inklusive Ablehnungsfall beim Datenschutz-Export.

## Nicht-Ziele

- Keine Änderungen an `middleware.ts`, an Migrationen oder an Warenkorb/Speisekarten-Code.
- Strikte Nonce-CSP (Folgeaufgabe, in `docs/security/threat-model.md` vermerkt).
