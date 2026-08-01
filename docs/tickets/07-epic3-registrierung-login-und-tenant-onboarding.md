## Kontext
Teil von **Epic 3: Auth & Autorisierung**.

## User Story
Als Restaurantbesitzer möchte ich mich registrieren und dabei automatisch einen Tenant anlegen, damit ich sofort loslegen kann.

## Umfang
Supabase-Auth-Integration, Registrierungs-/Login-Flow, automatische Tenant-Erstellung mit Owner-Mitgliedschaft bei Erstregistrierung.

## Explizite Nicht-Ziele
Kein Social Login in dieser Version, keine Mehrbenutzer-Registrierung in einem Schritt.

## Abhängigkeiten
Abhängig von "Tenant- und Mitgliedschafts-Datenmodell".

## Akzeptanzkriterien
- [ ] Neuer Nutzer kann sich registrieren und wird automatisch Owner eines neuen Tenants.
- [ ] Login funktioniert mit sicherer Session-Verwaltung.
- [ ] Fehlerhafte Anmeldeversuche geben keine Enumerationshinweise preis.

## UI-Zustände
Registrierungs-/Login-Formulare mit klaren Fehlermeldungen.

## Auswirkungen
- **API**: Auth-Routen.
- **Datenbank/Migration**: Nutzt bestehende `tenants`/`tenant_memberships`.
- **Mandantentrennung (Tenant-Isolation)**: Erstellt den ersten Tenant + Owner-Mitgliedschaft.
- **Berechtigungen**: Owner-Rolle wird zugewiesen.
- **Sicherheit**: Rate-Limiting auf Auth-Routen, sichere Session-Cookies.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Formulare mit Labels, Fehleransagen für Screenreader.
- **Observability**: Login-Fehlversuche werden auditiert.

## Risikokennzeichnung
`risk:security`

## Erforderliche Tests
Integrationstest Registrierung→Tenant→Owner-Mitgliedschaft; E2E-Test Login.

## Migration & Rollback
Keine neue.

## Dokumentations-Updates
`docs/product/mvp-scope.md` Onboarding-Abschnitt verlinken.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
