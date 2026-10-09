## Kontext

Der bestehende Banner (#146) hat nur "Ablehnen"/"Akzeptieren" für ein einziges Cookie. Gewünscht ist eine rechtlich möglichst abgesicherte, barrierefreie Einwilligungslösung (DSGVO Art. 6/7, **§ 25 TDDDG**, EuGH Planet49 C-673/17, BGH I ZR 7/16, DSK-Orientierungshilfe). Dies ist keine Rechtsberatung; vor dem Produktivbetrieb wird eine Prüfung durch eine Kanzlei/Datenschutzberatung empfohlen.

## Cookie-Inventar (Stand Code)

| Cookie | Zweck | Kategorie | Einwilligung |
|---|---|---|---|
| Supabase-Auth (`sb-*`) | Login/Sitzung (Personal) | notwendig, § 25 Abs. 2 Nr. 2 | nein |
| Warenkorb-Cookie (`cart-<slug>`) | Warenkorb des Gasts | notwendig | nein |
| Bestell-Cookie (`order-<slug>`) | Zugriff auf eigene Bestellung | notwendig | nein |
| `gastro_cookie_consent` | speichert die Entscheidung | notwendig | nein |
| `menu_view` | anonyme Seitenaufrufe zählen (#67) | Statistik | **ja (Opt-in)** |
| Stripe (auf checkout.stripe.com) | Zahlung | Drittanbieter, eigene Verantwortung | Hinweis in Datenschutzerklärung |

Schriften werden self-hosted (`next/font`), kein Google-Fonts-Request. Keine Marketing-/Tracking-Skripte.

## Umfang

- Banner mit **drei gleichwertigen Schaltflächen** auf erster Ebene: "Alle ablehnen", "Einstellungen", "Alle akzeptieren" (gleiche Größe/Gewichtung/Kontrast, keine Dark Patterns, kein vorangehaktes Häkchen, Schließen/Weiterscrollen gilt nie als Zustimmung).
- Einstellungs-Dialog (barrierefrei: `role="dialog"`, Fokus-Falle, ESC, Fokus-Rückgabe) mit Kategorien **Notwendig** (immer an, nicht abwählbar, erklärt) und **Statistik** (Opt-in, standardmäßig aus), je mit Tabelle: Name, Zweck, Dauer, Anbieter.
- Entscheidung versioniert speichern (`{ version, timestamp, statistics: bool }` im Consent-Cookie); bei neuer Banner-Version oder nach 6 Monaten erneute Abfrage; Nachweis (Art. 7 Abs. 1 DSGVO) = Version + Zeitstempel + Auswahl.
- Dauerhafter Link "Cookie-Einstellungen" auf **allen** öffentlichen Seiten (Widerruf so einfach wie Erteilung, Art. 7 Abs. 3); Widerruf löscht das `menu_view`-Cookie.
- Statistik-Cookie wird **nur** nach Opt-in gesetzt (Middleware prüft die Kategorie, nicht mehr nur "accepted").
- Datenschutzerklärung (`/r/[slug]/datenschutz`) um Cookie-Tabelle, Rechtsgrundlagen (§ 25 TDDDG, Art. 6 Abs. 1 lit. a/f DSGVO), Widerrufshinweis und Hinweis auf Stripe ergänzen — Inhalt muss exakt dem Code-Inventar entsprechen (falsche/unvollständige Angaben machen die Einwilligung unwirksam).
- Doku: `docs/legal/` Cookie-Inventar, Pflegeregel ("jedes neue Cookie/Skript → Inventar + Banner + Datenschutz im selben PR"), Hinweis auf externe Rechtsprüfung.

## Explizite Nicht-Ziele

Kein Drittanbieter-CMP, kein serverseitiges Consent-Log mit IP-Adressen (Datensparsamkeit), keine Marketing-/Tracking-Dienste, keine Rechtsberatung/Konformitätszusage.

## Akzeptanzkriterien

- [x] Vor einer Entscheidung wird kein nicht-notwendiges Cookie gesetzt (Test).
- [x] "Alle ablehnen" und "Alle akzeptieren" sind visuell gleichwertig und auf der ersten Ebene (Test/axe).
- [x] Statistik ist per Default aus; Auswahl wird versioniert gespeichert; Re-Prompt bei Versionswechsel/Ablauf (Test).
- [x] Widerruf über Footer-Link auf jeder öffentlichen Seite; löscht `menu_view` (Test).
- [x] Dialog ist per Tastatur bedienbar (Fokus-Falle, ESC, Fokus-Rückgabe), Screenreader-Labels, Kontrast AA hell und dunkel (a11y-Tests).
- [x] Datenschutzerklärung enthält die Cookie-Tabelle passend zum Inventar.
- [x] Doku aktualisiert, inkl. Hinweis auf externe Rechtsprüfung.

## Auswirkungen

- Datenbank/Migration: keine. Mandantentrennung: Cookie-Namen bleiben tenant-gescoped. Zahlungen: unverändert (Warenkorb/Bestell-Cookies notwendig).
- Datenschutz: Einwilligungsnachweis ohne zusätzliche personenbezogene Daten.

## Risikokennzeichnung

`risk:privacy`, `risk:accessibility`

## Erforderliche Tests

Komponenten-, Middleware-, a11y-Kontrast- und Tastatur-Tests; Cookie-Inventar-Test (jedes im Code gesetzte Cookie ist im Inventar gelistet).

## Definition of Done

- [x] Akzeptanzkriterien erfüllt
- [x] Tests grün (lint, typecheck, unit, build)
- [x] Dokumentation aktualisiert
- [ ] Opus-Validator: `APPROVED`

