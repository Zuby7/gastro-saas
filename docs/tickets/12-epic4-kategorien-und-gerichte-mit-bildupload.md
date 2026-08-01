## Kontext
Teil von **Epic 4: Restaurant-Profil & Menü-Verwaltung**.

## User Story
Als Owner möchte ich Kategorien anlegen und Gerichte mit Bildern hinzufügen, damit meine Speisekarte entsteht.

## Umfang
Tabellen `categories`, `dishes`, `media_assets`; Bildupload mit Typ-/Größenvalidierung und Re-Encoding, tenant-gescopte Storage-Pfade.

## Explizite Nicht-Ziele
Keine Varianten/Extras in diesem Ticket (folgt separat).

## Abhängigkeiten
Abhängig von "Restaurant-Profil & Öffnungszeiten".

## Akzeptanzkriterien
- [ ] Kategorien lassen sich anlegen, umbenennen, sortieren.
- [ ] Gerichte lassen sich anlegen, bearbeiten, archivieren (kein Hard-Delete).
- [ ] Bildupload lehnt unzulässige Dateitypen/-größen ab und legt Bilder tenant-gescoped ab.

## UI-Zustände
Kategorie-Liste mit Drag-Sort, Gericht-Formular mit Bildupload.

## Auswirkungen
- **API**: CRUD-Endpunkte.
- **Datenbank/Migration**: Neue Tabellen.
- **Mandantentrennung (Tenant-Isolation)**: Alle Entitäten tenant-gescoped inkl. Storage-Pfade.
- **Berechtigungen**: `menu.write` erforderlich.
- **Sicherheit**: Dateityp-/Größenvalidierung, Re-Encoding, signierte Upload-Policy.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Alt-Text-Pflichtfeld für Bilder.
- **Observability**: Änderungen auditiert.

## Risikokennzeichnung
`risk:security`

## Erforderliche Tests
Integrationstest Upload-Validierung (abgelehnte Dateitypen); Cross-Tenant-Test für Storage-Pfade.

## Migration & Rollback
Neu.

## Dokumentations-Updates
`docs/data/domain-model.md` aktualisieren.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
