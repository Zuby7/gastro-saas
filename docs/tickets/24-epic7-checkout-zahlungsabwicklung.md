## Kontext
Teil von **Epic 7: Zahlungen**.

## User Story
Als Kunde möchte ich sicher mit Karte bezahlen können, damit meine Bestellung verbindlich wird.

## Umfang
Serverseitige Neuberechnung des Gesamtbetrags unmittelbar vor Zahlungserstellung, Erstellung des Stripe-PaymentIntent/Checkout, Weiterleitung zur gehosteten Zahlungsseite.

## Explizite Nicht-Ziele
Kein eigenes Kartenformular (Stripe-gehostete Komponenten).

## Abhängigkeiten
Abhängig von "Stripe-Connect-Onboarding (Test-Modus)" und "Bestell-Zustandsmaschine und Checkout-Flow".

## Akzeptanzkriterien
- [ ] Zahlungsbetrag stammt ausschließlich aus der serverseitigen Neuberechnung.
- [ ] Ein clientseitiger Erfolg-Redirect setzt eine Bestellung niemals allein auf "bezahlt".

## UI-Zustände
Weiterleitung zur Stripe-Zahlungsseite, Rückkehr-/Bestätigungsseite.

## Auswirkungen
- **API**: Payment-Creation-Endpunkt.
- **Datenbank/Migration**: Tabelle `payments` (Grundstruktur).
- **Mandantentrennung (Tenant-Isolation)**: Zahlung ist an Tenant + Bestellung gebunden.
- **Berechtigungen**: Keine (Gast) zum Bezahlen.
- **Sicherheit**: Keine Client-Betrags-Vertrauensstellung.
- **Zahlungen**: Kernstück dieses Tickets.
- **Analytics**: payment_started-Event.
- **Barrierefreiheit**: Rückkehrseite zugänglich.
- **Observability**: Zahlungsversuche auditiert (ohne sensible Daten).

## Risikokennzeichnung
`risk:payment`

## Erforderliche Tests
Integrationstest mit Stripe-Test-Modus: Betrag entspricht Serverneuberechnung.

## Migration & Rollback
Neu (payments-Tabelle).

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
