## Kontext
Teil von **Epic 6: Warenkorb & Bestellung**.

## User Story
Als Kunde möchte ich als Gast zur Abholung oder Tischbestellung auschecken, damit meine Bestellung eindeutig und nachvollziehbar im System landet.

## Umfang
Tabellen `orders`, `order_items`, `order_item_selections`, `order_status_events`; Zustandsmaschine (awaiting_payment → received → accepted → preparing → ready → completed/cancelled); Snapshot der Bestellpositionen zum Kaufzeitpunkt.

## Explizite Nicht-Ziele
Keine Lieferoption (Feature-Flag-Platzhalter genügt).

## Abhängigkeiten
Abhängig von "Warenkorb mit serverseitiger Preisberechnung".

## Akzeptanzkriterien
- [ ] Ungültige Zustandsübergänge werden abgelehnt.
- [ ] Bestellpositionen speichern einen unveränderlichen Snapshot (Name/Preis/Steuer/Variante/Extras).
- [ ] Checkout erfasst nur die für die gewählte Erfüllungsart nötigen Daten.

## UI-Zustände
Checkout-Formular (Name, Kontakt je nach Erfüllungsart, Hinweisfeld).

## Auswirkungen
- **API**: Order-Erstellungs-Endpunkt.
- **Datenbank/Migration**: Neue Tabellen.
- **Mandantentrennung (Tenant-Isolation)**: Bestellungen tenant-gescoped.
- **Berechtigungen**: Keine (Gast) für Erstellung; `orders.manage` für spätere Statusänderung.
- **Sicherheit**: Rate-Limiting auf Checkout.
- **Zahlungen**: Erzeugt den Zustand `awaiting_payment` vor der eigentlichen Zahlung.
- **Analytics**: checkout_started-Event.
- **Barrierefreiheit**: Checkout-Formular vollständig zugänglich.
- **Observability**: Bestellstatus-Änderungen auditiert.

## Risikokennzeichnung
`risk:payment`

## Erforderliche Tests
Unit-Test Zustandsmaschine (inkl. verbotener Übergänge); Integrationstest Snapshot-Unveränderlichkeit.

## Migration & Rollback
Neu.

## Dokumentations-Updates
`docs/data/domain-model.md` Order-Immutability-Regel verlinken.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
