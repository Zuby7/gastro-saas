## Kontext
Teil von **Epic 8: Bestell-Betrieb**.

## User Story
Als Küchenpersonal möchte ich den Zubereitungsstatus einer Bestellung ändern können, ohne Zugriff auf Umsatzdaten zu haben.

## Umfang
Statuswechsel-Aktionen (angenommen → in Zubereitung → fertig) mit Berechtigungsprüfung gegen die Kitchen-Rolle.

## Explizite Nicht-Ziele
Keine Umsatzanzeige für die Kitchen-Rolle.

## Abhängigkeiten
Abhängig von "Live-Order-Dashboard für Personal".

## Akzeptanzkriterien
- [ ] Kitchen-Rolle kann Status ändern, aber keine Umsatz-/Refund-Daten sehen (expliziter Verweigerungstest).
- [ ] Ungültige Statussprünge werden von der Zustandsmaschine abgelehnt.

## UI-Zustände
Statuswechsel-Buttons je Bestellung.

## Auswirkungen
- **API**: Nutzt die Order-Zustandsmaschine aus Epic 6.
- **Datenbank/Migration**: Keine neue.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped.
- **Berechtigungen**: `orders.manage` mit Kitchen-Rollen-Einschränkung.
- **Sicherheit**: Keine.
- **Zahlungen**: Keine Sichtbarkeit für Kitchen-Rolle.
- **Analytics**: Keine.
- **Barrierefreiheit**: Statuswechsel-Buttons groß genug für Touch-Bedienung (Kitchen-Tablet).
- **Observability**: Statusänderungen auditiert.

## Risikokennzeichnung
keine besonderen Risiken identifiziert

## Erforderliche Tests
Permission-Boundary-Test: Kitchen kann Status ändern, aber nicht Umsatz/Refund sehen.

## Migration & Rollback
Keine.

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
