## Kontext
Teil von **Epic 11: Betrieb & Härtung**.

## User Story
Als Team möchten wir Fehler und Ausfälle frühzeitig bemerken, damit Probleme vor den Kunden auffallen.

## Umfang
Sentry-Integration (Fehler), Better-Stack-Integration (Uptime) gemäß `docs/platform/service-register.md`.

## Explizite Nicht-Ziele
Kein Log-Aggregations-System über das hinaus, was Sentry/Better Stack bieten.

## Abhängigkeiten
Abhängig von einem ersten Deployment auf Cloudflare Pages/Workers (Vorbereitungsticket, falls noch nicht vorhanden).

## Akzeptanzkriterien
- [ ] Ein absichtlich ausgelöster Testfehler erscheint in Sentry.
- [ ] Ein Health-Endpoint wird von Better Stack überwacht und löst bei Ausfall eine Benachrichtigung aus.

## UI-Zustände
Keine.

## Auswirkungen
- **API**: Health-Check-Endpunkt.
- **Datenbank/Migration**: Keine.
- **Mandantentrennung (Tenant-Isolation)**: Keine.
- **Berechtigungen**: Keine.
- **Sicherheit**: Keine sensiblen Daten in Fehlerberichten (Redaktion konfiguriert).
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: Kernstück dieses Tickets.

## Risikokennzeichnung
keine besonderen Risiken identifiziert

## Erforderliche Tests
Manueller Testfehler-Nachweis im PR.

## Migration & Rollback
Keine.

## Dokumentations-Updates
`docs/operations/deployment-strategy.md` aktualisieren.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
