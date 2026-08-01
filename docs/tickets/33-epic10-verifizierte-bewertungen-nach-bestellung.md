## Kontext

Teil von **Epic 10: Bewertungen & Qualität**.

## User Story

Als Kunde möchte ich nach einer abgeschlossenen Bestellung eine Bewertung abgeben können, damit andere Kunden und das Restaurant echtes Feedback bekommen.

## Umfang

Tabelle `ratings`; Bewertung nur über gültiges Bestell-Token bei abgeschlossener Bestellung; Sterne + optionaler Kommentar.

## Explizite Nicht-Ziele

Kein Import externer Plattform-Bewertungen.

## Abhängigkeiten

Abhängig von "Bestellstatus-Seite für Kunden".

## Akzeptanzkriterien

- [ ] Ohne gültiges Bestell-Token ist keine Bewertungsabgabe möglich.
- [ ] Eine Bestellung kann nur einmal bewertet werden.
- [ ] Aggregierte Bewertung aktualisiert sich korrekt.

## UI-Zustände

Bewertungsformular auf der Bestellstatus-Seite nach Abschluss.

## Auswirkungen

- **API**: Rating-Erstellung-Endpunkt.
- **Datenbank/Migration**: Neue Tabelle `ratings`.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped.
- **Berechtigungen**: Keine (tokenbasiert) zur Abgabe; `reviews.read` für Admin-Ansicht.
- **Sicherheit**: Token-Validierung, Missbrauchsschutz (Rate-Limiting).
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Formular zugänglich.
- **Observability**: Keine.

## Risikokennzeichnung

`risk:privacy`

## Erforderliche Tests

Integrationstest: ungültiges Token wird abgelehnt; Doppelbewertung wird verhindert.

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
