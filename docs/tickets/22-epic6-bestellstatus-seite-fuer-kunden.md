## Kontext

Teil von **Epic 6: Warenkorb & Bestellung**.

## User Story

Als Kunde möchte ich den Status meiner Bestellung einsehen können, ohne ein Konto zu benötigen.

## Umfang

Öffentliche, token-basierte Bestellstatus-Seite (kein Login nötig, aber auch nicht erratbar).

## Explizite Nicht-Ziele

Kein Live-Chat mit dem Restaurant.

## Abhängigkeiten

Abhängig von "Bestell-Zustandsmaschine und Checkout-Flow".

## Akzeptanzkriterien

- [ ] Status-Seite ist nur mit gültigem, nicht erratbarem Bestell-Token einsehbar.
- [ ] Interne Notizen/Mitarbeiterinformationen werden nie angezeigt.

## UI-Zustände

Bestellstatus-Seite mit klaren Zuständen.

## Auswirkungen

- **API**: Token-validierter Read-Endpunkt.
- **Datenbank/Migration**: Nutzt bestehende `orders`/`order_status_events`.
- **Mandantentrennung (Tenant-Isolation)**: Zugriff ausschließlich auf die eigene Bestellung.
- **Berechtigungen**: Keine (tokenbasiert).
- **Sicherheit**: Token ist kryptographisch zufällig, nicht erratbar/inkrementell.
- **Zahlungen**: Zeigt Zahlungsstatus, keine sensiblen Zahlungsdetails.
- **Analytics**: Keine.
- **Barrierefreiheit**: Statuswechsel werden angesagt.
- **Observability**: Keine.

## Risikokennzeichnung

keine besonderen Risiken identifiziert

## Erforderliche Tests

Integrationstest: falsches/erratenes Token wird abgelehnt.

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
