## Kontext
Teil von **Epic 7: Zahlungen**.

## User Story
Als Plattform möchte ich Zahlungsbestätigungen ausschließlich über verifizierte Webhooks verarbeiten, damit kein Betrug über gefälschte Client-Zustände möglich ist.

## Umfang
Tabelle `payment_webhook_events`; Signaturprüfung, Idempotenz nach Event-ID, Zustandsübergang der Bestellung zu "bezahlt" ausschließlich hierüber.

## Explizite Nicht-Ziele
Keine Verarbeitung unsignierter/unverifizierter Events.

## Abhängigkeiten
Abhängig von "Checkout-Zahlungsabwicklung".

## Akzeptanzkriterien
- [ ] Events mit ungültiger Signatur werden abgelehnt und nicht verarbeitet.
- [ ] Doppelt zugestellte Events verändern den Zustand nur einmal.
- [ ] Verzögerte/Out-of-order-Events führen zu keinem inkonsistenten Zustand.

## UI-Zustände
Keine.

## Auswirkungen
- **API**: Webhook-Endpunkt.
- **Datenbank/Migration**: Neue Tabelle `payment_webhook_events`.
- **Mandantentrennung (Tenant-Isolation)**: Event ist eindeutig einem Tenant/einer Bestellung zugeordnet.
- **Berechtigungen**: Keine (System-zu-System, signaturbasiert).
- **Sicherheit**: Zentrales Sicherheitsticket dieses Bereichs.
- **Zahlungen**: Kernstück dieses Tickets.
- **Analytics**: payment_succeeded-Event.
- **Barrierefreiheit**: Keine.
- **Observability**: Alle Webhook-Ereignisse werden geloggt (ohne sensible Nutzdaten).

## Risikokennzeichnung
`risk:payment`, `risk:security`

## Erforderliche Tests
Tests: gültig, ungültige Signatur, Duplikat, verzögert/out-of-order, Betragsabweichung.

## Migration & Rollback
Neu.

## Dokumentations-Updates
`docs/security/threat-model.md` Webhook-Zeilen verlinken.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
