## Kontext

Teil von **Epic 7: Zahlungen**. Nachgetragen nach dem Opus-Architektur-Review (2026-08-01): die MVP-Abnahme-Szenario in `docs/product/mvp-scope.md` verlangt "Kunde erhält Bestätigung", aber kein bisheriges Ticket implementierte den Versand.

## User Story

Als Kunde möchte ich nach erfolgreicher Zahlung und bei Statusänderungen eine E-Mail-Bestätigung erhalten, damit ich meine Bestellung nachvollziehen kann.

## Umfang

Serverseitiger E-Mail-Versand über Resend bei: Zahlung erfolgreich (Bestellbestätigung mit Positionen/Preisen/Abholzeit), Status wechselt zu "fertig" (optional). Tenant-spezifisches Branding im E-Mail-Template (Name/Logo), aber kein visueller Editor.

## Explizite Nicht-Ziele

Kein E-Mail-Vorlagen-Editor für Tenants. Kein Marketing-/Newsletter-Versand.

## Abhängigkeiten

Abhängig von "Webhook-Verarbeitung mit Idempotenz".

## Akzeptanzkriterien

- [ ] Nach erfolgreicher Zahlung erhält der Kunde automatisch eine Bestätigungs-E-Mail mit korrekten Positionen/Preisen.
- [ ] Ein fehlgeschlagener E-Mail-Versand blockiert niemals die Zahlungsverarbeitung oder setzt den Bestellstatus zurück (Versand ist bestenfalls, nicht transaktional an die Zahlung gekoppelt).
- [ ] Das Erreichen des Resend-Tageslimits (100/Tag im Free-Tier) führt zu einer sichtbaren Fehlermeldung im Observability-Tooling, nicht zu stillschweigend verlorenen E-Mails.

## UI-Zustände

Keine (E-Mail-Template selbst).

## Auswirkungen

- **API**: E-Mail-Versand-Funktion im `notifications`-Modul.
- **Datenbank/Migration**: Optional: `email_sends`-Protokolltabelle (Status, Zeitstempel, ohne vollständigen Inhalt).
- **Mandantentrennung (Tenant-Isolation)**: E-Mail-Inhalt und Branding sind strikt tenant-gescoped.
- **Berechtigungen**: Keine (systemseitig ausgelöst).
- **Sicherheit**: Keine sensiblen Zahlungsdetails im E-Mail-Inhalt oder Log.
- **Zahlungen**: Ausgelöst durch den `payment_succeeded`-Webhook, aber nicht Teil der Zahlungs-Zustandsmaschine.
- **Analytics**: Keine.
- **Barrierefreiheit**: E-Mail-Template mit semantischem HTML, Text-Alternative.
- **Observability**: Versandfehler werden geloggt/alarmiert (Sentry).

## Risikokennzeichnung

keine besonderen Risiken identifiziert

## Erforderliche Tests

Integrationstest: Zahlung erfolgreich löst E-Mail-Versand aus; Test für Tageslimit-Fehlerbehandlung.

## Migration & Rollback

Optional (Protokolltabelle).

## Dokumentations-Updates

`docs/platform/service-register.md` Resend-Risikohinweis verlinken.

## Definition of Done

- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
