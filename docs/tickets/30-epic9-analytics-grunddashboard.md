## Kontext
Teil von **Epic 9: Analytics**.

## User Story
Als Owner möchte ich Umsatz, Bestellzahlen und Durchschnittswerte auf einen Blick sehen, damit ich mein Geschäft versteht.

## Umfang
Dashboard mit Umsatz heute, bezahlte Bestellungen, Ø-Bestellwert, offene Bestellungen, Zahlungsfehlschläge — berechnet ausschließlich aus den eigenen Order-/Payment-Daten.

## Explizite Nicht-Ziele
Keine Nutzung von Drittanbieter-Produktanalytics für Umsatzzahlen.

## Abhängigkeiten
Abhängig von "Webhook-Verarbeitung mit Idempotenz", "Rückerstattungen".

## Akzeptanzkriterien
- [ ] Eine bezahlte Bestellung beeinflusst die Kennzahlen korrekt.
- [ ] Eine Rückerstattung reduziert den Netto-Umsatz korrekt.
- [ ] Bei unzureichenden Daten wird ein klarer Leerzustand angezeigt statt erfundener Zahlen.

## UI-Zustände
Dashboard-Kacheln mit Leerzuständen.

## Auswirkungen
- **API**: Aggregations-Queries (tenant-gescoped, zeitzonenkorrekt).
- **Datenbank/Migration**: Tabelle `daily_analytics_aggregates` (optional inkrementell befüllt).
- **Mandantentrennung (Tenant-Isolation)**: Strikt pro Tenant gefiltert.
- **Berechtigungen**: `analytics.read` erforderlich.
- **Sicherheit**: Keine.
- **Zahlungen**: Nutzt Payment-/Refund-Daten.
- **Analytics**: Kernstück dieses Tickets.
- **Barrierefreiheit**: Kennzahlen mit Textalternative, nicht nur Diagramm.
- **Observability**: Keine.

## Risikokennzeichnung
keine besonderen Risiken identifiziert

## Erforderliche Tests
Integrationstest: bezahlte Bestellung + Refund ergeben korrekten Netto-Umsatz; Timezone-/DST-Testfälle.

## Migration & Rollback
Ggf. neue Aggregat-Tabelle.

## Dokumentations-Updates
`docs/data/domain-model.md` Analytics-Abschnitt verlinken.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
