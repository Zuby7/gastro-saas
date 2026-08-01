## Kontext

Teil von **Epic 8: Bestell-Betrieb**.

## User Story

Als Personal möchte ich ein Gericht, eine Variante oder eine Option schnell als ausverkauft markieren, damit Kunden es nicht bestellen können.

## Umfang

Ausverkauft-Flag auf Gericht-/Varianten-/Optionsebene, sofortige Wirkung auf die öffentliche Speisekarte, optionale automatische Wiederverfügbarkeits-Zeit.

## Explizite Nicht-Ziele

Keine automatische Bestandsverwaltung/Inventarsystem.

## Abhängigkeiten

Abhängig von "Varianten, Optionsgruppen und Extras", "Live-Order-Dashboard für Personal".

## Akzeptanzkriterien

- [ ] Als ausverkauft markierte Elemente sind auf der öffentlichen Speisekarte umgehend nicht mehr bestellbar.
- [ ] Wiederherstellung der Verfügbarkeit funktioniert manuell und optional zeitgesteuert.

## UI-Zustände

Ausverkauft-Umschalter im Admin, deutliche Kennzeichnung auf der öffentlichen Speisekarte.

## Auswirkungen

- **API**: Availability-Update-Endpunkt.
- **Datenbank/Migration**: Verfügbarkeits-Flag auf bestehenden Tabellen/`availability_schedules`.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped.
- **Berechtigungen**: `menu.availability.manage` erforderlich.
- **Sicherheit**: Keine.
- **Zahlungen**: Verhindert Checkout nicht mehr verfügbarer Positionen (Zusammenspiel mit Epic 6).
- **Analytics**: Keine.
- **Barrierefreiheit**: Ausverkauft-Status nicht nur farblich signalisiert.
- **Observability**: Änderungen auditiert.

## Risikokennzeichnung

keine besonderen Risiken identifiziert

## Erforderliche Tests

E2E-Test: als ausverkauft markiertes Gericht ist auf der öffentlichen Seite sofort nicht bestellbar.

## Migration & Rollback

Ggf. kleine Migration für Flag/Zeitsteuerung.

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
