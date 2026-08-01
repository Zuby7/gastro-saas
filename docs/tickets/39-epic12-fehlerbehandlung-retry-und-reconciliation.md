## Kontext
Teil von **Epic 12: Integrationsfundament**.

## User Story
Als Plattform möchte ich fehlgeschlagene Synchronisationen automatisch erneut versuchen und nachvollziehen können, damit keine Bestellungen stillschweigend verloren gehen.

## Umfang
Retry-Mechanismus mit Backoff, Dead-Letter-Ablage nach Grenzwert, Reconciliation-Report (erwartet vs. tatsächlich synchronisiert).

## Explizite Nicht-Ziele
Kein voll automatisches Self-Healing ohne jede Sichtbarkeit für das Team.

## Abhängigkeiten
Abhängig von "Provider-neutrale Integrationsschnittstelle mit Mock-Provider".

## Akzeptanzkriterien
- [ ] Ein fehlgeschlagener Sync-Job wird automatisch mit Backoff wiederholt.
- [ ] Nach Erreichen des Grenzwerts landet der Job sichtbar in einer Dead-Letter-Ansicht statt zu verschwinden.

## UI-Zustände
Dead-Letter-/Fehler-Ansicht im Integrations-Bereich.

## Auswirkungen
- **API**: Retry-/Reconciliation-Funktionen.
- **Datenbank/Migration**: Nutzt `integration_errors`/`integration_sync_jobs`.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped.
- **Berechtigungen**: `integrations.manage` erforderlich.
- **Sicherheit**: Keine.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: Zentrales Ticket dieses Bereichs.

## Risikokennzeichnung
keine besonderen Risiken identifiziert

## Erforderliche Tests
Integrationstest: nach N Fehlversuchen landet der Job in der Dead-Letter-Ansicht.

## Migration & Rollback
Keine neue zwingend.

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
