## Kontext
Teil von **Epic 4: Restaurant-Profil & Menü-Verwaltung**.

## User Story
Als Owner möchte ich Allergene, Zusatzstoffe und Ernährungslabels je Gericht pflegen, damit Kunden informierte Entscheidungen treffen können.

## Umfang
Tabellen `allergens`, `additives`, `dietary_labels`, `dish_allergen_assignments`, `dish_additive_assignments`; Zuordnungs-UI im Admin.

## Explizite Nicht-Ziele
Keine automatische Ableitung von Allergenen aus Zutatennamen (keine KI/Heuristik).

## Abhängigkeiten
Abhängig von "Kategorien und Gerichte mit Bildupload".

## Akzeptanzkriterien
- [ ] Owner kann Allergene/Zusatzstoffe/Labels je Gericht zuordnen.
- [ ] Fehlende Allergen-Prüfung wird als Veröffentlichungs-Warnung erkannt (Vorbereitung).
- [ ] Kein automatischer Compliance-Anspruch im UI-Text (nur "vom Restaurant angegeben").

## UI-Zustände
Zuordnungs-Formular je Gericht.

## Auswirkungen
- **API**: CRUD-Endpunkte.
- **Datenbank/Migration**: Neue Tabellen.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped.
- **Berechtigungen**: `menu.write` erforderlich.
- **Sicherheit**: Keine.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Klare Beschriftung der Zuordnungs-Checkboxen.
- **Observability**: Änderungen auditiert.

## Risikokennzeichnung
`risk:privacy`

## Erforderliche Tests
Integrationstest: Zuordnung speichern/lesen.

## Migration & Rollback
Neu.

## Dokumentations-Updates
`docs/security/threat-model.md` Compliance-Abgrenzung verlinken.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
