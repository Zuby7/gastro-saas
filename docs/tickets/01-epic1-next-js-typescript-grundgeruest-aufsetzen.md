## Kontext
Teil von **Epic 1: Repository & Engineering Foundation**.

## User Story
Als Entwicklerteam möchte ich ein lauffähiges, typisiertes Projekt-Grundgerüst, damit Feature-Tickets darauf aufbauen können.

## Umfang
pnpm-Workspace, Next.js (App Router) unter `apps/web`, TypeScript strict, ESLint, Prettier, Tailwind, Basis-Ordnerstruktur gemäß `docs/architecture/domain-boundaries.md`.

## Explizite Nicht-Ziele
Keine Fachlogik, keine Datenbank-Anbindung.

## Abhängigkeiten
Keine.

## Akzeptanzkriterien
- [ ] `pnpm install && pnpm dev` startet eine leere Startseite lokal.
- [ ] `pnpm lint` und `pnpm typecheck` laufen fehlerfrei.
- [ ] Ordnerstruktur entspricht der Architektur-Dokumentation.

## UI-Zustände
Leere Platzhalter-Startseite.

## Auswirkungen
- **API**: Keine.
- **Datenbank/Migration**: Keine.
- **Mandantentrennung (Tenant-Isolation)**: Keine.
- **Berechtigungen**: Keine.
- **Sicherheit**: Keine.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Basis-HTML-Struktur ist semantisch korrekt.
- **Observability**: Keine.

## Risikokennzeichnung
keine besonderen Risiken identifiziert

## Erforderliche Tests
Smoke-Test: Startseite rendert.

## Migration & Rollback
Keine.

## Dokumentations-Updates
`README.md` Setup-Abschnitt aktualisieren.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
