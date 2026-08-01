## Kontext

Teil von **Epic 3: Auth & Autorisierung**.

## User Story

Als Owner möchte ich Mitarbeiter per Einladung zu meinem Tenant hinzufügen, damit ich nicht selbst alle Konten anlegen muss.

## Umfang

Tabelle `invitations` (single-use, expiring, tenant+rollen-gescoped), Einladungs-Versand (Resend), Annahme-Flow.

## Explizite Nicht-Ziele

Keine Massenimport-Funktion für Mitarbeiter.

## Abhängigkeiten

Abhängig von "Registrierung, Login und Tenant-Onboarding".

## Akzeptanzkriterien

- [ ] Einladungslink ist einmalig nutzbar und läuft nach konfigurierbarer Zeit ab.
- [ ] Angenommene Einladung erzeugt eine Mitgliedschaft mit der vorgesehenen Rolle.
- [ ] Abgelaufene/bereits genutzte Links werden klar abgelehnt.

## UI-Zustände

Einladungsformular, Annahmeseite.

## Auswirkungen

- **API**: `invitations`-Endpunkte.
- **Datenbank/Migration**: Neue Tabelle `invitations`.
- **Mandantentrennung (Tenant-Isolation)**: Einladung ist an genau einen Tenant gebunden.
- **Berechtigungen**: `users.invite` erforderlich zum Versenden.
- **Sicherheit**: Tokens sind zufällig, einmalig, zeitbegrenzt.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Annahmeseite barrierefrei.
- **Observability**: Einladungsversand/-annahme auditiert.

## Risikokennzeichnung

`risk:security`

## Erforderliche Tests

Integrationstest: abgelaufene/bereits genutzte Einladung wird abgelehnt.

## Migration & Rollback

Neu.

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
