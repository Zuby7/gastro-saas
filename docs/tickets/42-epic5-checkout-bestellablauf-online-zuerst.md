## Kontext

Teil von **Epic 5: Öffentliche Speisekarte** (Bestell-UX). Der Checkout fragt aktuell als erstes "Wie möchten Sie bestellen?" (Abholung / Tischbestellung) und stellt beide Varianten gleichrangig dar. Im Live-Test (2026-09-13) wurde deutlich: Der Hauptpfad ist die **Online-Bestellung mit Online-Bezahlung** (Abholung); die Tischbestellung (Tischnummer eingeben) ist der speziellere Fall und soll später im Ablauf kommen.

## User Story

Als Gast möchte ich im Checkout zuerst meine Bestellung abschließen (Name, Hinweise, Bezahlung) und die Tischbestellung nur dann sehen, wenn ich sie brauche, damit der häufigste Weg (online bestellen und bezahlen) schnell und ohne Umwege klappt.

## Umfang

- Reihenfolge im Checkout-Formular: Name → (Abholung: optionale Telefonnummer) → Hinweis → Einwilligung → Zahlungsübersicht → Button.
- Die Auswahl "Tischbestellung" wird von der ersten Frage zu einer nachgelagerten, klar beschrifteten Option ("Sie sitzen im Restaurant? Am Tisch bestellen") unterhalb der Kontaktdaten; Standard bleibt Abholung/Online-Bestellung.
- Wird "Tischbestellung" gewählt, erscheint das Pflichtfeld Tischnummer an dieser Stelle (statt der Telefonnummer).
- Serverseitige Validierung (`CheckoutSchema`) bleibt unverändert maßgeblich; der Formularwert `fulfillmentType` behält seine Werte `pickup`/`table`.

## Explizite Nicht-Ziele

Keine Änderung der Bestell-Zustandsmaschine, der Preisberechnung oder des Stripe-Ablaufs. Keine neue Bestellart (z. B. Lieferung).

## Abhängigkeiten

Abhängig von "Bestell-Zustandsmaschine und Checkout-Flow" (#21) und "Checkout-Zahlungsabwicklung" (#24) — beide umgesetzt.

## Akzeptanzkriterien

- [ ] Standardpfad (Abholung) zeigt keine Tisch-Eingabe und keine Frage nach der Bestellart als ersten Schritt.
- [ ] "Tischbestellung" ist weiterhin wählbar, erscheint nach den Kontaktdaten und verlangt eine Tischnummer.
- [ ] Beide Pfade senden dieselben Formularfelder wie bisher (kein Server-Vertragsbruch); bestehende Checkout-Action-Tests bleiben grün.
- [ ] Tastaturbedienung, sichtbarer Fokus, gruppierte Radios mit Legend/Label (a11y-Test angepasst und grün).

## UI-Zustände

Standard (Abholung), Tischbestellung gewählt (Tischnummer Pflicht), Fehlerzustand, Warenkorb nicht checkout-fähig.

## Auswirkungen

- **API**: keine.
- **Datenbank/Migration**: keine.
- **Mandantentrennung (Tenant-Isolation)**: unverändert (Tenant aus Slug-Bindung serverseitig).
- **Berechtigungen**: keine.
- **Sicherheit**: Server validiert `fulfillmentType`/`tableIdentifier` weiterhin selbst.
- **Zahlungen**: unverändert.
- **Analytics**: keine.
- **Barrierefreiheit**: Radiogruppe bleibt `fieldset`/`legend`; keine Information nur über Farbe.
- **Observability**: keine.

## Risikokennzeichnung

keine besonderen Risiken identifiziert

## Erforderliche Tests

Komponententest `checkout-form.test.tsx` (Reihenfolge, Pfadwechsel, Pflichtfeld), a11y-Design-Test anpassen.

## Migration & Rollback

Nicht zutreffend (reine UI-Änderung, per Revert zurückrollbar).

## Dokumentations-Updates

`docs/product` (Checkout-Ablauf) und diese Ticketdatei.

## Definition of Done

- [ ] Akzeptanzkriterien erfüllt
- [ ] Tests grün (lint, typecheck, unit, ggf. e2e)
- [ ] Tenant-Isolation weiterhin gewährleistet
- [ ] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`
