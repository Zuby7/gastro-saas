## Kontext
Teil von **Epic 5: Öffentliche Speisekarte**.

## User Story
Als Kunde möchte ich schnell durch Kategorien browsen und Gerichte mit Bild und Preis sehen, damit ich einfach bestellen kann.

## Umfang
Kategorien-Navigation (mobil sticky), Gericht-Kacheln mit Bild/Name/Preis/Labels/Ausverkauft-Status.

## Explizite Nicht-Ziele
Keine Such-/Filterfunktion (folgt separat).

## Abhängigkeiten
Abhängig von "Öffentliches Tenant-Routing".

## Akzeptanzkriterien
- [ ] Kategorien-Navigation bleibt beim Scrollen erreichbar (mobil).
- [ ] Ausverkaufte Gerichte sind eindeutig markiert, nicht nur farblich.
- [ ] Bilder haben Alt-Text und responsive Größen.

## UI-Zustände
Kategorien-Navigation, Gericht-Kacheln, Leerzustand ohne Gerichte.

## Auswirkungen
- **API**: Nutzt öffentliche Menü-Query.
- **Datenbank/Migration**: Keine neue.
- **Mandantentrennung (Tenant-Isolation)**: Nur veröffentlichte Daten des einen Tenants.
- **Berechtigungen**: Keine.
- **Sicherheit**: Keine.
- **Zahlungen**: Keine.
- **Analytics**: category_viewed/dish_viewed Events.
- **Barrierefreiheit**: Kein Farbe-als-einziges-Signal, ausreichender Kontrast.
- **Observability**: Keine.

## Risikokennzeichnung
keine besonderen Risiken identifiziert

## Erforderliche Tests
E2E-Test: Kategorien-Browsing; automatisierter A11y-Check.

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
