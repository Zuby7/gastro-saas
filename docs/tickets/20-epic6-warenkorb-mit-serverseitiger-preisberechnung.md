## Kontext

Teil von **Epic 6: Warenkorb & Bestellung**.

## User Story

Als Kunde möchte ich einen Warenkorb mit korrekten, verifizierten Preisen sehen, damit ich nicht überrascht werde.

## Umfang

Tabellen `carts`, `cart_items`, `cart_item_selections`; serverseitige Neuberechnung bei jeder Warenkorb-Änderung; Ablehnung nicht mehr verfügbarer Produkte vor Checkout.

## Explizite Nicht-Ziele

Keine Zahlungsabwicklung in diesem Ticket.

## Abhängigkeiten

Abhängig von "Gericht-Detailansicht mit Auswahl".

## Akzeptanzkriterien

- [ ] Angezeigter Gesamtpreis stammt immer aus einer serverseitigen Neuberechnung, nie aus reinen Client-Werten.
- [ ] Ein zwischenzeitlich ausverkauftes Produkt wird vor dem Checkout klar gemeldet und entfernt/blockiert.

## UI-Zustände

Warenkorb-Ansicht mit Positionen, Mengen, Gesamtsumme.

## Auswirkungen

- **API**: Warenkorb-Endpunkte.
- **Datenbank/Migration**: Neue Tabellen.
- **Mandantentrennung (Tenant-Isolation)**: Warenkorb ist tenant- und sitzungsgebunden.
- **Berechtigungen**: Keine (Gast).
- **Sicherheit**: Keine Client-Preis-Vertrauensstellung.
- **Zahlungen**: Grundlage der späteren Zahlungsabwicklung.
- **Analytics**: remove_from_cart-Event.
- **Barrierefreiheit**: Warenkorb-Änderungen werden angesagt (Screenreader).
- **Observability**: Keine.

## Risikokennzeichnung

`risk:payment`

## Erforderliche Tests

Unit-Test Preisneuberechnung; Integrationstest ausverkauftes Produkt wird abgelehnt.

## Migration & Rollback

Neu.

## Dokumentations-Updates

`.claude/rules/payments.md` referenzieren.

## Definition of Done

- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
