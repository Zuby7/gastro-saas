# Übersicht rechtlicher Rahmenwerke (Ticket #146)

> **Nicht rechtsverbindlich.** Dieses Dokument ist von Claude (einer KI, kein Anwalt)
> als technischer Ausgangspunkt erstellt und ersetzt keine anwaltliche Prüfung.
> Vor Produktivbetrieb (echte Restaurants, echte Zahlungen, echte Nutzerdaten)
> **muss** eine Rechtsanwältin/ein Rechtsanwalt AGB, Widerrufsrecht,
> Datenschutzerklärung und branchenspezifische Pflichten (Lebensmittelrecht,
> Preisangabenverordnung) prüfen. Siehe auch CLAUDE.md: "Claiming legal
> compliance without qualification" ist explizit verboten — nichts in diesem
> Dokument oder im Produkt behauptet rechtliche Konformität.

## Zweck

Kurzer, nicht erschöpfender Überblick, welche deutschen/EU-Regelwerke für
gastro-saas grundsätzlich relevant sind und was im Produkt jeweils darauf
einzahlt (technische Bausteine, nicht rechtliche Erfüllung).

## DSGVO (Datenschutz-Grundverordnung)

Betrifft: alle personenbezogenen Daten (Gäste, Restaurant-Mitarbeitende,
Betreiber-Konten).

Technische Bausteine im Produkt:
- Tenant-editierbare Datenschutzerklärung pro Restaurant
  (`/r/[slug]/datenschutz`, Ticket #41).
- Export-/Löschantrag für personenbezogene Daten (`/account/privacy`,
  Ticket #36).
- Bewertungsmoderation (Ticket #34) und Aufbewahrungsfristen (Ticket #36) für
  nutzergenerierte Inhalte.
- Consent-Banner für das nicht-essenzielle `menu_view`-Analytics-Cookie
  (Ticket #67/#146) — Cookies, die keine Consent-Grundlage brauchen (Supabase
  Auth, Warenkorb-Session), werden weiterhin ohne Banner gesetzt, da sie
  technisch notwendig sind (Art. 6 Abs. 1 lit. b/f DSGVO als denkbare
  Rechtsgrundlage — final zu prüfen).
- Kein PostHog oder anderes Drittanbieter-Tracking ist aktuell im Code
  eingebunden (Stand dieses Tickets) — falls das später hinzukommt, braucht es
  eine eigene Einordnung und ggf. Erweiterung des Consent-Banners.

## TMG (Telemediengesetz) — Impressumspflicht

Betrifft: jede geschäftsmäßige Website, hier: jede veröffentlichte
Restaurant-Speisekarte.

Technische Bausteine:
- Tenant-editierbares Impressum-Freitextfeld (`/r/[slug]/impressum`,
  Ticket #41), verlinkt im Footer der öffentlichen Speisekarte.
- Hinweistext im Restaurant-Profil-Formular, dass das Impressum vollständige
  Pflichtangaben enthalten muss (Firmenname, Anschrift,
  Vertretungsberechtigte, ggf. Handelsregister, Kontaktdaten) — die
  Vollständigkeit selbst ist technisch nicht prüfbar, nur die
  Erinnerung/das Feld.
- Nicht-blockierende Publish-Warnung, falls das Impressum-Feld leer ist.

## PAngV (Preisangabenverordnung)

Betrifft: Preisangaben auf der Speisekarte gegenüber Endverbrauchern.

Technische Bausteine: Preise sind immer inklusive (Gesamtpreis pro
Gericht/Variante, in Cent gespeichert, keine versteckten Zuschläge in der
Datenmodellierung); eine rechtliche Prüfung, ob z. B. Grundpreisangaben,
Bedienungsgeld-Hinweise o. Ä. je nach Bundesland/Angebot zusätzlich nötig
sind, ist nicht Teil dieses Tickets.

## Fernabsatzrecht / Widerrufsrecht (BGB §§ 312 ff.)

Betrifft: online abgeschlossene Bestellverträge zwischen Restaurant und Gast.

Technische Bausteine:
- Tenant-editierbares AGB-Freitextfeld inkl. Widerrufsrecht-/
  Rückerstattungsrichtlinie (`/r/[slug]/agb`, Ticket #146) — der tatsächliche
  Rechtstext (z. B. ob und wie ein Widerrufsrecht bei zubereiteten
  Speisen überhaupt greift, siehe § 312g Abs. 2 Nr. 2 BGB
  "kundenspezifisch hergestellte Waren") ist vom Betreiber selbst
  einzutragen und anwaltlich zu prüfen — dieses Feld ist ein reiner
  Platzhalter-Container, kein von Claude verfasster Rechtstext.
- Explizite Zustimmungs-Checkbox zu AGB/Datenschutz bei Registrierung und
  Checkout (Ticket #146), serverseitig validiert.
- Server-seitig neu berechnete Preise/Gesamtsummen bei Checkout (nie
  Client-Werte vertraut) — relevant für die Nachweisbarkeit des tatsächlich
  vereinbarten Preises.

## Barrierefreiheit (BITV/WCAG, perspektivisch BFSG)

Nicht direkt gesetzlich verpflichtend für jedes Restaurant, aber Teil der
Plattform-Qualität und einer möglichen künftigen Pflicht (Barrierefreiheitsstärkungsgesetz
für bestimmte Online-Angebote). Technische Bausteine: Pflicht-Alt-Text bei
Gerichte-Fotos, gelabelte Formularfelder, Tastaturbedienbarkeit, automatisierte
Kontrasttests (`*.a11y.test.ts`).

## Was dieses Ticket NICHT leistet

- Keine von Claude verfassten, rechtsverbindlichen AGB-, Widerrufs- oder
  Datenschutztexte.
- Keine Bewertung, ob ein Widerrufsrecht bei Speisenbestellungen im Einzelfall
  überhaupt besteht.
- Keine lebensmittelrechtliche Prüfung (Allergenkennzeichnung ist als
  Freitextfeld/Review-Flag umgesetzt, aber inhaltlich nicht geprüft).
- Keine Zertifizierung oder Zusicherung rechtlicher Konformität irgendeiner
  Art.
