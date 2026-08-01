## Kontext

Teil von **Epic 2: Architektur & Datenfundament**.

## User Story

Als Plattform möchte ich Restaurants als eigenständige Mandanten abbilden, damit jede Bestellung/jeder Datensatz eindeutig einem Tenant zugeordnet ist.

## Umfang

Tabellen `tenants`, `tenant_memberships`, `brands`, `locations` inkl. Migration und RLS-Policies gemäß `docs/data/domain-model.md`.

## Explizite Nicht-Ziele

Kein UI für Mehrstandort-Verwaltung.

## Abhängigkeiten

Abhängig von "Supabase lokal einrichten".

## Akzeptanzkriterien

- [ ] Migrationen laufen fehlerfrei.
- [ ] Jede Tabelle hat eine RLS-Policy im selben Migrationsfile.
- [ ] Ein Tenant hat zu jedem Zeitpunkt mindestens einen Owner (Constraint auf Datenbankebene, nicht nur UI) — siehe Ticket "Owner-Schutz vor versehentlicher Entfernung".

## UI-Zustände

Keine.

## Auswirkungen

- **API**: Interne Typen/Queries in `packages/domain/tenants`.
- **Datenbank/Migration**: Neue Tabellen + RLS.
- **Mandantentrennung (Tenant-Isolation)**: Grundlage der gesamten Mandantentrennung.
- **Berechtigungen**: Keine.
- **Sicherheit**: Keine Client-seitige tenant_id-Übergabe.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: Keine.

## Risikokennzeichnung

`risk:tenant-isolation`, `risk:migration`

## Erforderliche Tests

Integrationstest: RLS verweigert Zugriff auf fremden Tenant.

## Migration & Rollback

Neu, reversibel (down-Migration).

## Dokumentations-Updates

`docs/data/domain-model.md` als erfüllt markieren.

## Definition of Done

- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
