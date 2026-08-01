## Kontext

Teil von **Epic 7: Zahlungen**.

## User Story

Als Manager möchte ich eine Bestellung ganz oder teilweise zurückerstatten können, damit ich auf Kundenanliegen reagieren kann.

## Umfang

Tabelle `refunds`; serverseitiger Stripe-Refund-Aufruf; Audit-Eintrag mit Betrag/Grund/Referenz/Zeitstempel/Akteur.

## Explizite Nicht-Ziele

Kein automatisches Rückerstattungs-Vorschlagssystem.

## Abhängigkeiten

Abhängig von "Webhook-Verarbeitung mit Idempotenz".

## Akzeptanzkriterien

- [ ] Rückerstattung erfordert die Berechtigung `payments.refund`.
- [ ] Eine Rückerstattung kann den bezahlten Betrag nie überschreiten.
- [ ] Jede Rückerstattung erzeugt einen vollständigen Audit-Eintrag.

## UI-Zustände

Rückerstattungs-Dialog im Bestell-Admin.

## Auswirkungen

- **API**: Refund-Endpunkt.
- **Datenbank/Migration**: Neue Tabelle `refunds`.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped.
- **Berechtigungen**: `payments.refund` erforderlich.
- **Sicherheit**: Serverseitige Grenzwertprüfung gegen Überzahlung.
- **Zahlungen**: Kernstück dieses Tickets.
- **Analytics**: Beeinflusst Netto-Umsatz-Berechnung (Epic 9).
- **Barrierefreiheit**: Dialog zugänglich.
- **Observability**: Audit-Eintrag verpflichtend.

## Risikokennzeichnung

`risk:payment`

## Erforderliche Tests

Integrationstest: Überzahlung wird verhindert; Test ohne Berechtigung wird abgelehnt.

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
