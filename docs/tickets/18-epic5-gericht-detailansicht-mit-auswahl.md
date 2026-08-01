## Kontext

Teil von **Epic 5: Öffentliche Speisekarte**.

## User Story

Als Kunde möchte ich Variante, Extras und entfernbare Zutaten auswählen können, bevor ich ein Gericht in den Warenkorb lege.

## Umfang

Detail-Dialog/-Seite mit Pflicht-/Wahloptionen, Extras, entfernbaren Zutaten, Live-Preisanzeige (Client-Vorschau, serverseitig später verifiziert).

## Explizite Nicht-Ziele

Kein Warenkorb-Persistenz-Mechanismus (folgt in Epic 6).

## Abhängigkeiten

Abhängig von "Varianten, Optionsgruppen und Extras", "Speisekarten-UI mit Kategorien-Navigation".

## Akzeptanzkriterien

- [ ] Pflichtoptionen müssen ausgewählt sein, bevor "In den Warenkorb" aktivierbar ist.
- [ ] Min/Max-Auswahlregeln werden im UI durchgesetzt.
- [ ] Dialog ist vollständig per Tastatur bedienbar und screenreader-zugänglich.

## UI-Zustände

Detail-Dialog mit Formularvalidierung.

## Auswirkungen

- **API**: Keine neue (nutzt bestehende Menü-Query).
- **Datenbank/Migration**: Keine neue.
- **Mandantentrennung (Tenant-Isolation)**: Keine zusätzliche.
- **Berechtigungen**: Keine.
- **Sicherheit**: Client-Preisanzeige ist nur Vorschau, keine Kauf-Wahrheit.
- **Zahlungen**: Vorbereitung für serverseitige Preisprüfung in Epic 6.
- **Analytics**: add_to_cart-Event.
- **Barrierefreiheit**: Zentral für dieses Ticket (accessible dialog).
- **Observability**: Keine.

## Risikokennzeichnung

keine besonderen Risiken identifiziert

## Erforderliche Tests

E2E-Test: Pflichtauswahl erzwungen; automatisierter A11y-Check des Dialogs.

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
