## Kontext
Teil von **Epic 12: Integrationsfundament**.

## User Story
Als Plattform möchte ich eine einheitliche Schnittstelle für externe Bestell-/POS-Anbindungen haben, damit spätere Integrationen keinen Kernumbau erfordern.

## Umfang
Tabellen `integration_accounts`, `integration_sync_jobs`, `integration_errors`; Interface für Menü-Export, Preis-/Verfügbarkeits-Sync, Bestellimport/-bestätigung; Mock-Provider für Entwicklung/Tests.

## Explizite Nicht-Ziele
Keine echte Lieferando/Wolt/Uber-Eats/POS-Anbindung — nur offizielle, autorisierte APIs kämen später in Frage, niemals Scraping.

## Abhängigkeiten
Abhängig von "Entwurf/Veröffentlichungs-Workflow mit Qualitätsprüfung", "Bestell-Zustandsmaschine und Checkout-Flow".

## Akzeptanzkriterien
- [ ] Mock-Provider kann Menü exportieren und einen simulierten Bestelleingang auslösen.
- [ ] Die Master-Speisekarte bleibt die Quelle der Wahrheit, sofern kein dokumentierter Integrationsmodus etwas anderes vorsieht.

## UI-Zustände
Integrations-Übersicht im Admin (Status: verbunden/Mock/Fehler).

## Auswirkungen
- **API**: Integrations-Schnittstellen-Funktionen.
- **Datenbank/Migration**: Neue Tabellen.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped, kein Daten-Leck zwischen Tenants über den Mock-Provider.
- **Berechtigungen**: `integrations.manage` erforderlich.
- **Sicherheit**: Keine Secrets im Mock-Provider.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: Sync-Vorgänge auditiert.

## Risikokennzeichnung
keine besonderen Risiken identifiziert

## Erforderliche Tests
Integrationstest: Mock-Export/-Import funktioniert; Cross-Tenant-Test für Sync-Daten.

## Migration & Rollback
Neu.

## Dokumentations-Updates
`docs/architecture/domain-boundaries.md` integrations-Modul verlinken.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
