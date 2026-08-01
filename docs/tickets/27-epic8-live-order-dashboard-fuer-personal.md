## Kontext

Teil von **Epic 8: Bestell-Betrieb**.

## User Story

Als Personal möchte ich eingehende Bestellungen live sehen, damit ich schnell reagieren kann.

## Umfang

Admin-Ansicht neue/angenommene/in Zubereitung/fertige/abgeschlossene/stornierte Bestellungen mit Echtzeit-Aktualisierung (mit Polling-Fallback).

## Explizite Nicht-Ziele

Keine Kitchen-Display-Hardware-Integration.

## Abhängigkeiten

Abhängig von "Bestell-Zustandsmaschine und Checkout-Flow".

## Akzeptanzkriterien

- [ ] Neue Bestellungen erscheinen ohne manuelles Neuladen (Echtzeit oder kurzes Polling).
- [ ] Nur berechtigte Rollen (gemäß `orders.read`) sehen Bestellungen ihres Tenants.

## UI-Zustände

Bestell-Board mit Spalten je Status.

## Auswirkungen

- **API**: Order-List-Endpunkt (tenant-gescoped, paginiert).
- **Datenbank/Migration**: Keine neue.
- **Mandantentrennung (Tenant-Isolation)**: Ausschließlich Bestellungen des eigenen Tenants.
- **Berechtigungen**: `orders.read` erforderlich.
- **Sicherheit**: Keine.
- **Zahlungen**: Zeigt Zahlungsstatus je Bestellung.
- **Analytics**: Keine.
- **Barrierefreiheit**: Statuswechsel für Screenreader ansagbar.
- **Observability**: Keine.

## Risikokennzeichnung

`risk:tenant-isolation`

## Erforderliche Tests

Cross-Tenant-Test: Dashboard zeigt nie fremde Bestellungen.

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
