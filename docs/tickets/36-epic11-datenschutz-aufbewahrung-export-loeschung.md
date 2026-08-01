## Kontext
Teil von **Epic 11: Betrieb & Härtung**.

## User Story
Als Owner möchte ich meine Tenant-Daten exportieren oder eine Löschung beantragen können, damit ich meinen datenschutzrechtlichen Pflichten nachkomme.

## Umfang
Tenant-Datenexport-Funktion, Lösch-Workflow (mit Rücksicht auf gesetzliche Aufbewahrungsfristen bei Bestell-/Zahlungsdaten), konfigurierbare Aufbewahrungsfristen für Logs/Analytics-Events.

## Explizite Nicht-Ziele
Keine automatische Rechtsberatung/Compliance-Zertifizierung im Produkt.

## Abhängigkeiten
Abhängig von "Analytics-Grunddashboard".

## Akzeptanzkriterien
- [ ] Export enthält die wesentlichen Tenant-Daten in einem verwendbaren Format.
- [ ] Löschantrag respektiert dokumentierte gesetzliche Aufbewahrungspflichten (z. B. Bestell-/Rechnungsdaten) statt sie zu ignorieren.

## UI-Zustände
Export-/Löschantrag-Aktion in den Einstellungen.

## Auswirkungen
- **API**: Export-/Löschantrags-Endpunkte.
- **Datenbank/Migration**: Keine neue zwingend.
- **Mandantentrennung (Tenant-Isolation)**: Nur eigene Tenant-Daten.
- **Berechtigungen**: `tenant.settings.write` bzw. Owner-only für Löschantrag.
- **Sicherheit**: Export nur für autorisierte Rollen.
- **Zahlungen**: Zahlungsreferenzen unterliegen eigener Aufbewahrungslogik.
- **Analytics**: Keine.
- **Barrierefreiheit**: Keine.
- **Observability**: Export-/Löschvorgänge auditiert.

## Risikokennzeichnung
`risk:privacy`

## Erforderliche Tests
Integrationstest: Löschantrag respektiert Aufbewahrungsfrist für Bestelldaten.

## Migration & Rollback
Ggf. Retention-Konfigurationstabelle.

## Dokumentations-Updates
`docs/security/threat-model.md` Datenschutz-Abschnitt verlinken.

## Definition of Done
- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, integration, ggf. e2e)
- [ ] Migration validiert (falls zutreffend)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Sicherheitsprüfung bestanden
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
