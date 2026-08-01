## Kontext
Teil von **Epic 9: Analytics**.

## User Story
Als Owner möchte ich Zeiträume vergleichen und sehen, welche Extras/entfernten Zutaten häufig vorkommen, damit ich mein Angebot anpassen kann.

## Umfang
Zeitraumvergleich (heute vs. Vortag, Woche vs. Vorwoche, Monat vs. Vormonat, freier Zeitraum vs. gleich langer Vorzeitraum) inkl. Stichprobengröße; Extras-/Entfernte-Zutaten-Auswertung.

## Explizite Nicht-Ziele
Keine KI-gestützte Freitext-Auswertung von Bestellhinweisen.

## Abhängigkeiten
Abhängig von "Analytics-Grunddashboard".

## Akzeptanzkriterien
- [ ] Ein unvollständiger aktueller Zeitraum wird nicht unkommentiert mit einem vollständigen Vorzeitraum verglichen.
- [ ] Extras-Auswertung zeigt Auswahlrate und zusätzlichen Umsatz korrekt.

## UI-Zustände
Trend-Widget mit Zeitraum-Auswahl, Extras-Tabelle.

## Auswirkungen
- **API**: Trend-/Extras-Query-Funktionen.
- **Datenbank/Migration**: Nutzt bestehende Order-/Analytics-Tabellen.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped, zeitzonenkorrekt.
- **Berechtigungen**: `analytics.read` erforderlich.
- **Sicherheit**: Keine.
- **Zahlungen**: Nutzt Extra-Preisdaten.
- **Analytics**: Kernstück dieses Tickets.
- **Barrierefreiheit**: Zeitraum-Auswahl per Tastatur bedienbar.
- **Observability**: Keine.

## Risikokennzeichnung
keine besonderen Risiken identifiziert

## Erforderliche Tests
Timezone-/DST-Testfälle; Test für unvollständigen-vs-vollständigen Zeitraumvergleich.

## Migration & Rollback
Keine neue.

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
