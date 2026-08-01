## Kontext
Teil von **Epic 2: Architektur & Datenfundament**.

## User Story
Als Plattformbetreiber möchte ich sicherheitsrelevante Aktionen nachvollziehen können, ohne sensible Daten zu speichern.

## Umfang
Tabelle `audit_logs` (tenant, actor, action, target_type, target_id, timestamp, safe metadata, correlation id) + Write-only-Interface in `packages/domain/audit`.

## Explizite Nicht-Ziele
Kein UI zum Anzeigen des Audit-Logs (folgt in Epic 11).

## Abhängigkeiten
Abhängig von "Tenant- und Mitgliedschafts-Datenmodell".

## Akzeptanzkriterien
- [ ] Audit-Einträge sind unveränderlich (kein Update/Delete aus Anwendungscode möglich).
- [ ] Schreibfunktion verweigert das Speichern von Secrets/Zahlungsdaten (Testfall).

## UI-Zustände
Keine.

## Auswirkungen
- **API**: `recordAuditEvent()`-Funktion.
- **Datenbank/Migration**: Neue Tabelle `audit_logs`.
- **Mandantentrennung (Tenant-Isolation)**: Audit-Einträge sind tenant-gescoped.
- **Berechtigungen**: `audit.read` Berechtigung definiert (Nutzung folgt später).
- **Sicherheit**: Verhindert versehentliches Loggen von Secrets.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: Grundlage für spätere Observability.

## Risikokennzeichnung
`risk:privacy`

## Erforderliche Tests
Unit-Test: Secret-artige Werte werden abgelehnt/redigiert.

## Migration & Rollback
Neu.

## Dokumentations-Updates
`docs/security/threat-model.md` Audit-Abschnitt verlinken.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
