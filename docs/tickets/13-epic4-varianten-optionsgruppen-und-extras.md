## Kontext

Teil von **Epic 4: Restaurant-Profil & Menü-Verwaltung**.

## User Story

Als Owner möchte ich Größen, Pflicht-/Wahloptionen und Extras konfigurieren, damit komplexe Produkte wie Pizza-Größen oder Burger-Zutaten abbildbar sind.

## Umfang

Tabellen `dish_variants`, `option_groups`, `options`, `dish_option_group_assignments`, `ingredients`, `removable_ingredients`; Min/Max-Auswahllogik.

## Explizite Nicht-Ziele

Keine Frontend-Auswahl-UI (folgt in Epic 5/6).

## Abhängigkeiten

Abhängig von "Kategorien und Gerichte mit Bildupload".

## Akzeptanzkriterien

- [ ] Optionsgruppen unterstützen Pflicht- und Wahlauswahl mit Min/Max.
- [ ] Ungültige Min/Max-Kombinationen werden bei der Konfiguration abgelehnt.
- [ ] Ein Gericht ohne kaufbare Variante wird von der späteren Qualitätsprüfung erkannt (Vorbereitung für Ticket "Regelbasierte Qualitätsprüfung").

## UI-Zustände

Varianten-/Optionsgruppen-Editor im Admin.

## Auswirkungen

- **API**: CRUD-Endpunkte.
- **Datenbank/Migration**: Neue Tabellen.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped.
- **Berechtigungen**: `menu.write` erforderlich.
- **Sicherheit**: Keine.
- **Zahlungen**: Preisfelder je Variante/Extra.
- **Analytics**: Grundlage für spätere Extras-Analytics.
- **Barrierefreiheit**: Keine (UI folgt später).
- **Observability**: Keine.

## Risikokennzeichnung

keine besonderen Risiken identifiziert

## Erforderliche Tests

Unit-Tests für Min/Max-Validierung.

## Migration & Rollback

Neu.

## Dokumentations-Updates

`docs/data/domain-model.md` aktualisieren.

## Definition of Done

- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
