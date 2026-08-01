---
name: Ticket
about: Standard-Ticket-Template für gastro-saas (siehe docs/tickets/README.md)
title: ""
labels: []
---

## Kontext

<!-- Warum wird das gebraucht? Bezug zum Produkt/Epic. -->

## User Story

<!-- Als ... möchte ich ..., damit ... -->

## Umfang

<!-- Genauer Umfang dieses Tickets. -->

## Explizite Nicht-Ziele

<!-- Was dieses Ticket bewusst NICHT umfasst. -->

## Abhängigkeiten

<!-- Andere Tickets/Entscheidungen, die vorher fertig sein müssen. -->

## Akzeptanzkriterien

- [ ] ...

## UI-Zustände

<!-- Falls zutreffend: Leerzustand, Ladezustand, Fehlerzustand, Erfolg. -->

## Auswirkungen

- **API**:
- **Datenbank/Migration**:
- **Mandantentrennung (Tenant-Isolation)**:
- **Berechtigungen**:
- **Sicherheit**:
- **Zahlungen**:
- **Analytics**:
- **Barrierefreiheit**:
- **Observability**:

## Erforderliche Tests

<!-- Unit / Integration / E2E / Cross-Tenant / Payment-Webhook, je nach Ticket. -->

## Migration & Rollback

<!-- Falls zutreffend. -->

## Dokumentations-Updates

<!-- Welche docs/ Datei muss angepasst werden? -->

## Definition of Done

- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
