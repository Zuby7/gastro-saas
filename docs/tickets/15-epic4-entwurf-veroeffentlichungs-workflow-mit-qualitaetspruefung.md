## Kontext
Teil von **Epic 4: Restaurant-Profil & Menü-Verwaltung**.

## User Story
Als Owner möchte ich Änderungen erst im Entwurf sehen und gezielt veröffentlichen, damit meine Kunden nie eine halbfertige Speisekarte sehen.

## Umfang
`menu_versions`-Modell (Draft/Published), Vorschau-Ansicht, regelbasierte Blocker/Warnungen gemäß `docs/product/mvp-scope.md` (z. B. fehlender Preis, Optionsgruppe ohne Optionen, kein veröffentlichbares Gericht ohne kaufbare Variante).

## Explizite Nicht-Ziele
Kein Rollback auf ältere Version in diesem Ticket (Datenmodell erlaubt es, Flow folgt später).

## Abhängigkeiten
Abhängig von "Varianten, Optionsgruppen und Extras" und "Allergene, Zusatzstoffe und Ernährungslabels".

## Akzeptanzkriterien
- [ ] Änderungen am Entwurf wirken sich nicht auf die live veröffentlichte Speisekarte aus.
- [ ] Blocker verhindern die Veröffentlichung, Warnungen nicht.
- [ ] Veröffentlichungs-Zeitpunkt und veröffentlichender Nutzer werden gespeichert.

## UI-Zustände
Entwurf-/Veröffentlichen-Umschalter, Vorschau, Blocker-/Warnungsliste.

## Auswirkungen
- **API**: Publish-Endpunkt mit serverseitiger Validierung.
- **Datenbank/Migration**: Neue Tabelle `menu_versions`.
- **Mandantentrennung (Tenant-Isolation)**: Tenant-gescoped.
- **Berechtigungen**: `menu.publish` separat von `menu.write`.
- **Sicherheit**: Keine.
- **Zahlungen**: Blocker bei aktivem Online-Checkout ohne gültige Zahlungskonfiguration.
- **Analytics**: Keine.
- **Barrierefreiheit**: Blocker-/Warnungsliste screenreader-verständlich.
- **Observability**: Veröffentlichung auditiert.

## Risikokennzeichnung
`risk:migration`

## Erforderliche Tests
Unit-Tests je Blocker-/Warnungsregel; Integrationstest Draft-bleibt-privat.

## Migration & Rollback
Neu.

## Dokumentations-Updates
`docs/product/mvp-scope.md` Abschnitt Qualitätsprüfung verlinken.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
