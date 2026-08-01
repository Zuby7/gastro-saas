## Kontext

Teil von **Epic 5: Öffentliche Speisekarte**. Nachgetragen nach dem Opus-Architektur-Review (2026-08-01): der einzige bisherige Datenschutz-Ticket (Export/Löschung) war fälschlich als post-MVP eingestuft, obwohl die öffentliche Speisekarte bereits im MVP personenbezogene Daten von Gästen erhebt (Checkout) und deutschen Endkunden angezeigt wird.

## User Story

Als Owner möchte ich Impressum und Datenschutzerklärung pflegen können, und als Kunde möchte ich diese vor dem Checkout einsehen können, damit die grundlegenden rechtlichen Informationspflichten erfüllt sind.

## Umfang

Tenant-gepflegte Impressum-/Datenschutz-Freitextfelder (Rich-Text oder Markdown), Anzeige auf der öffentlichen Speisekarte (Footer-Link) und ein Datenschutzhinweis im Checkout-Formular. Zusätzlich: PostHog bleibt pro Tenant standardmäßig deaktiviert, bis eine dokumentierte Rechtsgrundlage/Consent vorliegt (gemäß `docs/platform/service-register.md`).

## Explizite Nicht-Ziele

Keine automatische Rechtsberatung oder Compliance-Zertifizierung. Kein Cookie-Consent-Banner-Baukasten über das hinaus, was für Cloudflare Turnstile/PostHog nötig ist.

## Abhängigkeiten

Abhängig von "Öffentliches Tenant-Routing".

## Akzeptanzkriterien

- [ ] Owner kann Impressum- und Datenschutztext pflegen und veröffentlichen.
- [ ] Fehlender Impressum-/Datenschutztext wird von der Veröffentlichungs-Qualitätsprüfung als Warnung (nicht zwingend Blocker) erkannt.
- [ ] Checkout zeigt einen Datenschutzhinweis mit Link zur vollständigen Erklärung, bevor die Bestellung abgeschickt wird.
- [ ] PostHog-Tracking ist für einen Tenant ohne explizite Aktivierung standardmäßig aus.

## UI-Zustände

Footer-Links, Impressum-/Datenschutz-Seiten, Checkout-Hinweis.

## Auswirkungen

- **API**: Nutzt bestehendes `restaurant_profiles`-CRUD (neue Textfelder).
- **Datenbank/Migration**: Neue Spalten auf `restaurant_profiles` oder eigene Tabelle `legal_pages`.
- **Mandantentrennung (Tenant-Isolation)**: Texte sind tenant-gescoped.
- **Berechtigungen**: `tenant.settings.write` erforderlich zum Bearbeiten.
- **Sicherheit**: Freitext wird sanitisiert gerendert (kein XSS über Rich-Text-Felder).
- **Zahlungen**: Keine.
- **Analytics**: Deaktiviert PostHog standardmäßig pro Tenant.
- **Barrierefreiheit**: Seiten mit korrekter Überschriftenstruktur.
- **Observability**: Keine.

## Risikokennzeichnung

`risk:privacy`

## Erforderliche Tests

Integrationstest: fehlender Text löst Veröffentlichungs-Warnung aus; XSS-Test für Freitext-Rendering.

## Migration & Rollback

Neu (kleine Spalten-/Tabellenänderung).

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
