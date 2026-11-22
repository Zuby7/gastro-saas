## Ziel

PayPal im Checkout anbieten, ohne dass wir Händler der Zahlung sind und ohne PayPal-Partnerfreigabe: Jedes Restaurant hinterlegt die Zugangsdaten (Client-ID und Secret) einer eigenen PayPal-REST-App. Das Geld geht direkt an das Restaurant (Händler = Restaurant). Hintergrund: Stripe unterstützt PayPal nicht mit Connect-Direct-Charges oder `on_behalf_of` (siehe #193); die Marktplatz-Schnittstelle von PayPal (Partner Referrals) ist nur für freigegebene Partner.

## Umfang

- Tabelle für Restaurant-PayPal-Zugangsdaten mit RLS in derselben Migration; Secret **verschlüsselt** (AES-GCM, Schlüssel als Worker-Secret), nie an den Browser, nie in Logs
- Zahlungen-Seite: "PayPal verbinden" (Client-ID, Secret, Umgebung Sandbox), Status, Trennen; einfache Anleitung
- Kasse: Zahlart-Auswahl (Stripe: Karte, Klarna, Apple Pay u. a. / PayPal), PayPal nur anzeigen, wenn das Restaurant verbunden ist
- Serverseitig: PayPal-Order (Orders v2) mit dem serverseitig berechneten Betrag; Rücksprung-Route erfasst (capture) die Zahlung serverseitig mit den Restaurant-Zugangsdaten, prüft Status COMPLETED, Betrag und Währung, setzt die Bestellung über dieselbe atomare Funktion wie der Stripe-Webhook auf "bezahlt"; idempotent (PayPal-Request-Id)
- Erstattungen über PayPal (Capture-Refund) oder klar gesperrt mit Hinweis
- Hartes Sandbox-Gate: Live-Umgebung nur mit ausdrücklicher Freigabe (Env-Flag), wie beim Stripe-Testmodus

## Nicht-Ziele

Keine Partner-Referrals/Plattformgebühr über PayPal, keine Kartendaten, keine Live-Zahlungen, kein PayPal-Konto-Anlegen durch uns.

## Akzeptanzkriterien

- [ ] Ohne Verbindung erscheint PayPal nirgends; Stripe-Ablauf unverändert
- [ ] Zugangsdaten verschlüsselt, nicht auslesbar über RLS/PostgREST/Browser, nicht in Logs; Cross-Tenant-Test
- [ ] Zahlung gilt erst nach serverseitig verifiziertem Capture (Status, Betrag, Währung) als bezahlt
- [ ] Doppelte Rücksprünge/Captures sind idempotent
- [ ] Erstattung funktioniert oder ist mit klarer Meldung gesperrt
- [ ] Sandbox-Gate getestet; ADR und Doku (Restaurant-Anleitung) aktualisiert
- [ ] Opus-Review: APPROVED
