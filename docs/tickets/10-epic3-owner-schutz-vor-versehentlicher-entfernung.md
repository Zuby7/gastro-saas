## Kontext

Teil von **Epic 3: Auth & Autorisierung**.

## User Story

Als Plattform möchte ich verhindern, dass ein Tenant ohne Owner zurückbleibt, damit niemand versehentlich ausgesperrt wird.

## Umfang

Datenbank-Constraint/Check + Anwendungslogik, die das Entfernen/Herabstufen des letzten Owners verhindert.

## Explizite Nicht-Ziele

Kein Owner-Transfer-UI in diesem Ticket.

## Abhängigkeiten

Abhängig von "Rollen und granulare Berechtigungen".

## Akzeptanzkriterien

- [ ] Der letzte verbleibende Owner eines Tenants kann weder entfernt noch in der Rolle geändert werden.
- [ ] Versuch löst eine klare, verständliche Fehlermeldung aus.

## UI-Zustände

Fehlermeldung im Team-Verwaltungs-UI.

## Auswirkungen

- **API**: Validierung in der Mitgliedschafts-Änderungsfunktion.
- **Datenbank/Migration**: Constraint/Trigger oder Anwendungs-Transaktion mit Prüfung.
- **Mandantentrennung (Tenant-Isolation)**: Betrifft Mitgliedschaften pro Tenant.
- **Berechtigungen**: `users.manage` betroffen.
- **Sicherheit**: Verhindert Lockout-Angriffsszenario.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: Versuch wird auditiert.

## Risikokennzeichnung

`risk:security`

## Erforderliche Tests

Integrationstest: letzten Owner entfernen schlägt fehl.

## Migration & Rollback

Ggf. Constraint-Migration.

## Dokumentations-Updates

`docs/security/threat-model.md` Owner-Lockout-Zeile verlinken.

## Definition of Done

- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
