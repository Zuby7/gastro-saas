## Kontext

Teil von **Epic 11: Betrieb & Härtung**.

## User Story

Als Team möchten wir vor jeder möglichen Produktionsfreigabe eine einheitliche Checkliste durchlaufen, damit nichts vergessen wird.

## Umfang

Implementierung der im `/release-check`-Skill beschriebenen Prüfungen (Migrationen, Umgebungsvariablen, Observability, Backup/Rollback, Smoke-Tests) als ausführbares Skript/Checkliste.

## Explizite Nicht-Ziele

Kein automatisches Deployment nach Produktion — das bleibt immer eine separate, explizit freizugebende Aktion.

## Abhängigkeiten

Abhängig von "Error- und Uptime-Monitoring einrichten".

## Akzeptanzkriterien

- [ ] Checkliste erkennt fehlende Umgebungsvariablen.
- [ ] Checkliste erkennt fehlende/inkonsistente Migrationen.
- [ ] Ergebnis macht explizit klar, dass die eigentliche Produktionsfreigabe weiterhin manuell erfolgen muss.

## UI-Zustände

Keine (CLI/Skill-Ausgabe).

## Auswirkungen

- **API**: Keine.
- **Datenbank/Migration**: Keine.
- **Mandantentrennung (Tenant-Isolation)**: Keine.
- **Berechtigungen**: Keine.
- **Sicherheit**: Keine.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: Zentrales Ticket dieses Bereichs.

## Risikokennzeichnung

keine besonderen Risiken identifiziert

## Erforderliche Tests

Testlauf gegen die Staging-Umgebung.

## Migration & Rollback

Keine.

## Dokumentations-Updates

`docs/operations/deployment-strategy.md` verlinken.

## Definition of Done

- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
