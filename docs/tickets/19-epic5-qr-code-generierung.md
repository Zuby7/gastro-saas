## Kontext
Teil von **Epic 5: Öffentliche Speisekarte**.

## User Story
Als Owner möchte ich QR-Codes für Restaurant, Speisekarte, Tische oder Abholtheke erzeugen, damit Kunden einfach auf die Bestellseite gelangen.

## Umfang
QR-Code-Generierung (serverseitig) für konfigurierbare Ziel-URLs (Restaurant, Tisch-Nr., Abholung); Download als Bild.

## Explizite Nicht-Ziele
Kein Druck-Layout-Designer.

## Abhängigkeiten
Abhängig von "Öffentliches Tenant-Routing".

## Akzeptanzkriterien
- [ ] QR-Code verweist korrekt auf die tenant-spezifische URL inkl. optionalem Tisch-Parameter.
- [ ] QR-Code ist als Bilddatei herunterladbar.

## UI-Zustände
QR-Code-Generator im Admin.

## Auswirkungen
- **API**: QR-Generierungs-Endpunkt.
- **Datenbank/Migration**: Optional: Tisch-Bezeichner-Tabelle (minimal).
- **Mandantentrennung (Tenant-Isolation)**: QR-Ziel ist immer tenant-gescoped.
- **Berechtigungen**: `menu.read` ausreichend.
- **Sicherheit**: Keine.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: Keine.

## Risikokennzeichnung
keine besonderen Risiken identifiziert

## Erforderliche Tests
Unit-Test: generierte URL enthält korrekten Tenant-Slug/Tisch-Parameter.

## Migration & Rollback
Optional.

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
