## Kontext

Teil von **Epic 7: Zahlungen**.

## User Story

Als Owner möchte ich mein Stripe-Konto verbinden, damit ich Zahlungen empfangen kann, sobald ich bereit bin.

## Umfang

Stripe-Connect-Onboarding-Flow (gehostetes Onboarding), Tracking von `charges_enabled`/`payouts_enabled`/Status in `payment_accounts`, ausschließlich Test-Modus.

## Explizite Nicht-Ziele

Keine Live-Aktivierung ohne explizite spätere Freigabe.

## Abhängigkeiten

Abhängig von "Restaurant-Profil & Öffnungszeiten".

## Akzeptanzkriterien

- [ ] Onboarding-Status wird korrekt gespeichert und im Admin angezeigt.
- [ ] Es werden keine sensiblen Verifizierungsdokumente direkt vom Server verarbeitet (nur über Stripe-gehostetes Onboarding).
- [ ] Secret Keys sind ausschließlich serverseitig vorhanden.

## UI-Zustände

Onboarding-Status-Anzeige im Admin (Einstellungen).

## Auswirkungen

- **API**: Connect-Onboarding-Endpunkte.
- **Datenbank/Migration**: Tabelle `payment_accounts`.
- **Mandantentrennung (Tenant-Isolation)**: Ein Zahlungskonto pro Tenant.
- **Berechtigungen**: `payments.read` zum Ansehen des Status.
- **Sicherheit**: Keine Secret-Exposition an den Client.
- **Zahlungen**: Zentrales Ticket dieses Bereichs.
- **Analytics**: Keine.
- **Barrierefreiheit**: Statusanzeige klar formuliert.
- **Observability**: Onboarding-Statusänderungen auditiert.

## Risikokennzeichnung

`risk:payment`, `risk:security`

## Erforderliche Tests

Integrationstest mit Stripe-Test-Modus-Fixtures.

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
