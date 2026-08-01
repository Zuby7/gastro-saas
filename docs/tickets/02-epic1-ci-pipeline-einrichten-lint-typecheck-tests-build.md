## Kontext

Teil von **Epic 1: Repository & Engineering Foundation**.

## User Story

Als Team möchte ich, dass jeder Pull Request automatisch geprüft wird, damit fehlerhafte Änderungen nicht gemergt werden.

## Umfang

GitHub-Actions-Workflow: Install (mit Lockfile), Format-Check, Lint, Typecheck, Unit-Tests, Build, Secret-Scan. Required Check auf dem `main`-Branch.

## Explizite Nicht-Ziele

Kein E2E-Test in dieser Pipeline-Version, kein Deployment.

## Abhängigkeiten

Abhängig von "Next.js/TypeScript-Grundgerüst aufsetzen".

## Akzeptanzkriterien

- [ ] Workflow läuft bei jedem PR automatisch.
- [ ] Ein fehlgeschlagener Check blockiert den Merge.
- [ ] Cache wird sinnvoll genutzt, ohne Secrets zu cachen.

## UI-Zustände

Keine.

## Auswirkungen

- **API**: Keine.
- **Datenbank/Migration**: Keine.
- **Mandantentrennung (Tenant-Isolation)**: Keine.
- **Berechtigungen**: Keine.
- **Sicherheit**: Secret-Scan als Teil der Pipeline.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: CI-Status sichtbar in PRs.

## Risikokennzeichnung

keine besonderen Risiken identifiziert

## Erforderliche Tests

Pipeline selbst wird durch einen absichtlich fehlschlagenden Test-Branch verifiziert (im PR-Nachweis dokumentieren, nicht dauerhaft einchecken).

## Migration & Rollback

Keine.

## Dokumentations-Updates

`docs/testing/test-strategy.md` CI-Abschnitt verlinken.

## Definition of Done

- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
