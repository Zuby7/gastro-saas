## Kontext

Teil von **Epic 1: Repository & Engineering Foundation**.

## User Story

Als Entwicklerteam möchte ich lokal gegen eine echte Postgres-Instanz mit RLS entwickeln, damit Tenant-Isolation von Anfang an testbar ist.

## Umfang

Supabase-CLI lokal (Docker), Migrationsordner-Konvention, Seed-Skript-Grundgerüst, `.env.example`.

## Explizite Nicht-Ziele

Keine echten Supabase-Cloud-Projekte, kein Produktions-Setup.

## Abhängigkeiten

Abhängig von "Next.js/TypeScript-Grundgerüst aufsetzen".

## Akzeptanzkriterien

- [ ] `supabase start` läuft lokal.
- [ ] Ein Beispiel-Migrationsfile mit RLS-Policy existiert und wird per CI validiert.
- [ ] `.env.example` enthält alle benötigten Variablen ohne echte Werte.

## UI-Zustände

Keine.

## Auswirkungen

- **API**: Keine.
- **Datenbank/Migration**: Migrationsordner-Konvention, Beispielmigration.
- **Mandantentrennung (Tenant-Isolation)**: Beispiel-RLS-Policy als Referenzmuster.
- **Berechtigungen**: Keine.
- **Sicherheit**: Keine Secrets im Repo.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: Keine.

## Risikokennzeichnung

`risk:migration`

## Erforderliche Tests

Migrationsvalidierung in CI.

## Migration & Rollback

Erste Beispielmigration, lokal reversibel.

## Dokumentations-Updates

`docs/operations/deployment-strategy.md` Abschnitt lokale Entwicklung ergänzen.

## Definition of Done

- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
