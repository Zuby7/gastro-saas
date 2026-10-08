## Kontext

Teil von **Epic 6: Bestellungen** (Nachgang zur Bestellstatus-Seite #22 und den Transaktions-E-Mails #40). Nach bezahlter Bestellung soll der Gast einen **digitalen Beleg ("digitaler Kassenbon")** abrufen, ansehen, drucken/als PDF speichern können, statt auf Papier angewiesen zu sein.

## User Story

Als Gast möchte ich nach erfolgreicher Online-Zahlung einen übersichtlichen digitalen Beleg meiner Bestellung öffnen und speichern können, damit ich einen Nachweis über Positionen, Preise und Zahlung habe.

## Umfang

- Neue öffentliche, tokenbasierte Seite `/r/[slug]/orders/[token]/beleg` (gleiches Zugriffsmodell wie die Bestellstatus-Seite: Besitz des Gast-Tokens, kein Login).
- Inhalt: Restaurantname, Bestellnummer/-datum, Bestellart, Positionen mit Menge/Einzelpreis/Zeilensumme, Gesamtsumme, Zahlungsart-Hinweis ("Online bezahlt"), Zeitpunkt der Zahlung.
- Beleg nur für **bezahlte** Bestellungen (nicht `awaiting_payment`/abgebrochen); sonst neutrale Hinweisseite.
- Druck-/PDF-freundliches Layout (Print-Stylesheet), Button "Beleg drucken / als PDF speichern" (`window.print()`), Link von der Bestellstatus-Seite.
- Rechtlicher Hinweis auf dem Beleg: "Digitaler Bestellbeleg — kein steuerlich qualifizierter Kassenbeleg" (keine Behauptung von Steuer-/KassenSichV-Konformität; steuerliche Angaben des Betreibers sind ein separates Thema).

## Explizite Nicht-Ziele

Keine TSE/Fiskalisierung, keine USt-Ausweisung/Steuerberechnung, kein PDF-Server-Rendering, kein E-Mail-Anhang (ggf. Folge-Ticket).

## Abhängigkeiten

Abhängig von #22 (Bestellstatus), #24/#25 (Zahlung/Webhook) — umgesetzt.

## Akzeptanzkriterien

- [x] Beleg ist für bezahlte Bestellungen per Token abrufbar und zeigt ausschließlich serverseitig berechnete Beträge.
- [x] Falsches/unbekanntes Token oder Token eines anderen Tenants liefert dieselbe generische "nicht gefunden"-Seite wie die Statusseite (kein Orakel).
- [x] Unbezahlte/abgebrochene Bestellung zeigt keinen Beleg.
- [x] Druckansicht blendet Navigation/Buttons aus und ist auf Papier/PDF lesbar.
- [x] Rechtlicher Hinweis ("kein steuerlich qualifizierter Kassenbeleg") ist sichtbar.
- [x] Cross-Tenant-Test: Token von Tenant A ist unter Slug von Tenant B nicht abrufbar.

## UI-Zustände

Beleg anzeigen, nicht gefunden, noch nicht bezahlt, Druckansicht.

## Auswirkungen

- **API**: Wiederverwendung `getOrderStatusByToken()`; falls Zahlungszeitpunkt fehlt, minimale Erweiterung der RPC.
- **Datenbank/Migration**: voraussichtlich keine (ggf. kleine RPC-Erweiterung um `paid_at`).
- **Mandantentrennung (Tenant-Isolation)**: Token-Hash-Lookup, Slug-Abgleich wie Statusseite.
- **Berechtigungen**: keine (Gast-Token).
- **Sicherheit**: keine personenbezogenen Daten über Name/Hinweis hinaus; keine Zahlungsdaten (nie Kartendaten).
- **Zahlungen**: nur Anzeige; "bezahlt" ausschließlich aus Webhook-bestätigtem Status.
- **Analytics**: keine.
- **Barrierefreiheit**: semantische Tabelle/Liste, Kontrast, Druck-Stylesheet.
- **Observability**: keine.

## Risikokennzeichnung

`risk:privacy` (Gast-Token-Zugriff auf Bestelldaten), `risk:payment` (Anzeige von Zahlungsstatus)

## Erforderliche Tests

Seitentest (bezahlt/unbezahlt/nicht gefunden/Tenant-Mismatch), a11y-Design-Test, Print-Klassen-Test, Cross-Tenant-Test.

## Migration & Rollback

Nur falls RPC erweitert wird: additive Migration, per Revert rückrollbar.

## Dokumentations-Updates

`docs/product` (Bestellablauf/Beleg), `docs/security` (Token-Zugriff), diese Ticketdatei.

## Definition of Done

- [x] Akzeptanzkriterien erfüllt
- [x] Tests grün (lint, typecheck, unit, ggf. e2e)
- [x] Migration validiert (nicht zutreffend: keine Migration, bestehende RPC wiederverwendet)
- [x] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [x] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
