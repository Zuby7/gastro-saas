## Kontext
Teil von **Epic 2: Architektur & Datenfundament**.

## User Story
Als Team möchte ich einen wiederverwendbaren Testaufbau mit zwei Tenants, damit jedes zukünftige Ticket Mandantentrennung automatisiert prüfen kann.

## Umfang
Testfixture in `packages/testing`, das zwei Tenants mit ähnlichen Daten seedet und Hilfsfunktionen zum Assert von Cross-Tenant-Zugriffsverweigerung bereitstellt.

## Explizite Nicht-Ziele
Keine UI-Tests in diesem Ticket.

## Abhängigkeiten
Abhängig von "Tenant- und Mitgliedschafts-Datenmodell". **Nicht** abhängig von der Auth-Implementierung (Epic 3): die Fixture erzeugt Test-Sessions direkt auf DB-/JWT-Ebene (z. B. via Supabase Admin-API oder direkt signierte Test-Tokens), damit dieses Ticket vor Epic 3 bearbeitet werden kann (Korrektur nach Opus-Architektur-Review, siehe `docs/decisions/assumptions.md`).

## Akzeptanzkriterien
- [ ] Fixture erzeugt zwei Tenants mit Mitgliedschaften.
- [ ] Hilfsfunktion `expectCrossTenantDenied(...)` verfügbar und dokumentiert.
- [ ] Mindestens ein Beispieltest nutzt die Fixture erfolgreich.

## UI-Zustände
Keine.

## Auswirkungen
- **API**: Keine.
- **Datenbank/Migration**: Nur Testdaten, keine Schemaänderung.
- **Mandantentrennung (Tenant-Isolation)**: Zentrales Werkzeug zur Absicherung.
- **Berechtigungen**: Keine.
- **Sicherheit**: Keine.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: Keine.

## Risikokennzeichnung
`risk:tenant-isolation`

## Erforderliche Tests
Beispieltest gegen die Fixture.

## Migration & Rollback
Keine.

## Dokumentations-Updates
`docs/testing/test-strategy.md` verlinken.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
