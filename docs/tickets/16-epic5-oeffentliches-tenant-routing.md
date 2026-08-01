## Kontext
Teil von **Epic 5: Öffentliche Speisekarte**.

## User Story
Als Kunde möchte ich über eine eindeutige URL genau ein Restaurant sehen, damit ich nicht versehentlich fremde Daten sehe.

## Umfang
Öffentliche Routen nach Tenant-Slug, dedizierte öffentliche Query-Funktionen (nur veröffentlichte, nicht-sensible Spalten).

## Explizite Nicht-Ziele
Keine Marktplatz-/Übersichtsseite über mehrere Restaurants.

## Abhängigkeiten
Abhängig von "Entwurf/Veröffentlichungs-Workflow mit Qualitätsprüfung".

## Akzeptanzkriterien
- [ ] Aufruf der Slug-URL zeigt ausschließlich Daten dieses einen, veröffentlichten Tenants.
- [ ] Nicht veröffentlichte Tenants liefern eine saubere "nicht verfügbar"-Seite, keinen Fehler mit internen Details.

## UI-Zustände
Öffentliche Layout-Hülle.

## Auswirkungen
- **API**: Öffentliche Read-Only-Query-Funktionen.
- **Datenbank/Migration**: Keine neue.
- **Mandantentrennung (Tenant-Isolation)**: Zentral für dieses Ticket.
- **Berechtigungen**: Keine (öffentlich, unauthentifiziert).
- **Sicherheit**: Keine Leckage interner Felder.
- **Zahlungen**: Keine.
- **Analytics**: Seitenaufruf-Event (menu_viewed).
- **Barrierefreiheit**: Basis-Seitenstruktur mit korrekten Landmarks.
- **Observability**: Keine.

## Risikokennzeichnung
`risk:tenant-isolation`

## Erforderliche Tests
Cross-Tenant-Test: Slug A liefert nie Daten von Tenant B.

## Migration & Rollback
Keine.

## Dokumentations-Updates
Keine zusätzliche.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
