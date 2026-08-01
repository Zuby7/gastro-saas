## Kontext
Teil von **Epic 3: Auth & Autorisierung**.

## User Story
Als Owner möchte ich Standard-Rollen (Owner/Manager/Kitchen/Service/Marketing) nutzen oder eigene Rollen mit feingranularen Rechten definieren, damit jeder Mitarbeiter nur das sieht, was er braucht.

## Umfang
Tabellen `roles`, `permissions`, `role_permissions`, `membership_roles`; Standard-Rollen-Seeds; serverseitige Permission-Checks gemäß `.claude/rules/auth.md`.

## Explizite Nicht-Ziele
Kein UI-Rollen-Editor in diesem Ticket (folgt separat, falls nötig).

## Abhängigkeiten
Abhängig von "Registrierung, Login und Tenant-Onboarding".

## Akzeptanzkriterien
- [ ] Alle in `docs/data/domain-model.md` gelisteten Standard-Permission-Keys existieren.
- [ ] Jede serverseitige Aktion prüft die Berechtigung, nicht nur das UI.
- [ ] Test belegt: Kitchen-Rolle kann keine Umsatzdaten lesen; Marketing-Rolle kann nicht refunden.

## UI-Zustände
Keine (folgt später).

## Auswirkungen
- **API**: Permission-Check-Middleware.
- **Datenbank/Migration**: Neue Tabellen.
- **Mandantentrennung (Tenant-Isolation)**: Rollen sind tenant-gescoped.
- **Berechtigungen**: Kernstück dieses Tickets.
- **Sicherheit**: Serverseitige Durchsetzung, keine UI-only-Prüfung.
- **Zahlungen**: `payments.refund` als eigene Berechtigung.
- **Analytics**: `analytics.read` als eigene Berechtigung.
- **Barrierefreiheit**: Keine.
- **Observability**: Rechteänderungen auditiert.

## Risikokennzeichnung
`risk:security`

## Erforderliche Tests
Permission-Boundary-Tests für jede Standard-Rolle (Verweigerungsfall explizit getestet).

## Migration & Rollback
Neu.

## Dokumentations-Updates
`.claude/rules/auth.md` referenzieren.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
