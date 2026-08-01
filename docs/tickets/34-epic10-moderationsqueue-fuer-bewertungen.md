## Kontext

Teil von **Epic 10: Bewertungen & Qualität**.

## User Story

Als Manager möchte ich unangemessene Bewertungen prüfen und verbergen können, bevor sie öffentlich sichtbar sind.

## Umfang

Tabelle `rating_moderation`; Moderationsstatus (ausstehend/freigegeben/verborgen), Admin-Liste zur Bearbeitung.

## Explizite Nicht-Ziele

Kein automatisiertes KI-Moderationssystem.

## Abhängigkeiten

Abhängig von "Verifizierte Bewertungen nach Bestellung".

## Akzeptanzkriterien

- [ ] Neue Bewertungen starten im konfigurierbaren Moderationsstatus.
- [ ] Nur berechtigte Rollen (`reviews.moderate`) können den Status ändern.

## UI-Zustände

Moderations-Liste im Admin.

## Auswirkungen

- **API**: Moderations-Update-Endpunkt.
- **Datenbank/Migration**: Neue Tabelle `rating_moderation`.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped.
- **Berechtigungen**: `reviews.moderate` erforderlich.
- **Sicherheit**: Keine.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Liste zugänglich.
- **Observability**: Moderationsentscheidungen auditiert.

## Risikokennzeichnung

keine besonderen Risiken identifiziert

## Erforderliche Tests

Permission-Boundary-Test für `reviews.moderate`.

## Migration & Rollback

Neu.

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
