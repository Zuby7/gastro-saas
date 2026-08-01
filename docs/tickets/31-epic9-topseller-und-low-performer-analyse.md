## Kontext

Teil von **Epic 9: Analytics**.

## User Story

Als Owner möchte ich sehen, welche Gerichte gut und welche schlecht laufen, mit nachvollziehbaren Belegen statt unbegründeten Behauptungen.

## Umfang

Ranking nach Menge/Umsatz je Gericht; Low-Performer-Kennzeichnung nur mit ausreichender Datenbasis (konfigurierbarer Mindestschwellenwert) und mit Beleg-Zahlen (Aufrufe, Warenkorb-Hinzufügungen, Käufe).

## Explizite Nicht-Ziele

Keine automatische Ursachenzuschreibung (z. B. "der Preis ist schuld") ohne Beleg.

## Abhängigkeiten

Abhängig von "Analytics-Grunddashboard".

## Akzeptanzkriterien

- [ ] Ein neues/selten aufgerufenes Gericht wird nicht ohne ausreichende Datenbasis als "Low Performer" bezeichnet.
- [ ] Jede Low-Performer-Kennzeichnung zeigt die zugrunde liegenden Zahlen (Views/Add-to-Cart/Käufe/Conversion).

## UI-Zustände

Topseller-/Low-Performer-Liste mit Beleg-Zahlen.

## Auswirkungen

- **API**: Analytics-Query-Funktionen.
- **Datenbank/Migration**: Nutzt `analytics_events`.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped.
- **Berechtigungen**: `analytics.read` erforderlich.
- **Sicherheit**: Keine.
- **Zahlungen**: Nutzt Umsatzdaten je Gericht.
- **Analytics**: Kernstück dieses Tickets.
- **Barrierefreiheit**: Liste ist als Tabelle mit Kopfzeilen zugänglich.
- **Observability**: Keine.

## Risikokennzeichnung

keine besonderen Risiken identifiziert

## Erforderliche Tests

Unit-Test Mindestschwellenwert-Logik; Test für korrekte Mengen- vs. Umsatz-Unterscheidung.

## Migration & Rollback

Keine neue.

## Dokumentations-Updates

`docs/product/mvp-scope.md` referenzieren.

## Definition of Done

- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
