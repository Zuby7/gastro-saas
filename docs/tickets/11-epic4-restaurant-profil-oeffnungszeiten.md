## Kontext
Teil von **Epic 4: Restaurant-Profil & Menü-Verwaltung**.

## User Story
Als Owner möchte ich Name, Beschreibung, Kontakt, Öffnungszeiten und Branding pflegen, damit mein öffentliches Profil korrekt ist.

## Umfang
Tabellen `restaurant_profiles`, `opening_hours`; Admin-Formular zur Pflege.

## Explizite Nicht-Ziele
Kein öffentliches Profil-Rendering (folgt in Epic 5).

## Abhängigkeiten
Abhängig von "Registrierung, Login und Tenant-Onboarding".

## Akzeptanzkriterien
- [ ] Owner/Manager kann Profil und Öffnungszeiten speichern.
- [ ] Zeitzonenkorrekte Speicherung der Öffnungszeiten.
- [ ] Validierung verhindert widersprüchliche Öffnungszeiten (z. B. Ende vor Beginn).

## UI-Zustände
Profil-Formular, Öffnungszeiten-Editor.

## Auswirkungen
- **API**: CRUD-Endpunkte.
- **Datenbank/Migration**: Neue Tabellen.
- **Mandantentrennung (Tenant-Isolation)**: Profil ist strikt tenant-gescoped.
- **Berechtigungen**: `tenant.settings.write` erforderlich.
- **Sicherheit**: Keine.
- **Zahlungen**: Keine.
- **Analytics**: Keine.
- **Barrierefreiheit**: Formular vollständig mit Tastatur bedienbar.
- **Observability**: Änderungen auditiert.

## Risikokennzeichnung
keine besonderen Risiken identifiziert

## Erforderliche Tests
Unit-Test Öffnungszeiten-Validierung; Integrationstest Speichern/Lesen.

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
