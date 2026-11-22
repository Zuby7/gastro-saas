## Ergebnis der Untersuchung (2026-10-09, Stripe-Testmodus)

Im Stripe-Checkout erscheint PayPal nicht. Tests per API (`POST /v1/checkout/sessions`):

- PayPal + Connect (`transfer_data.destination`): `Your Stripe account currently does not support Connect payments with PayPal. To enable PayPal with Connect ... review the eligibility guidelines` (https://docs.stripe.com/payments/paypal#connect)
- PayPal + `on_behalf_of`: `on_behalf_of cannot be used with the paypal payment method`
- PayPal nur auf dem Plattform-Konto (ohne Connect): funktioniert
- Dynamische Zahlarten mit Connect: card, bancontact, eps, klarna, link, mb_way, amazon_pay, satispay (Apple Pay/Google Pay über Karte)

## Konsequenz

PayPal ist mit dem heutigen Modell (Destination Charge mit `on_behalf_of`, ADR-0002) nicht möglich. Voraussetzungen: (1) Stripe schaltet PayPal für Connect auf dem Plattform-Konto frei (Eligibility prüfen, ggf. Stripe-Support), (2) `on_behalf_of` entfällt für PayPal-Zahlungen. Das verändert, wer Händler der Zahlung ist (Haftung, Steuern, Abrechnung/Statement-Descriptor, Erstattungen: `refund-service.ts` geht von Destination Charges aus).

## Aufgabe

- Eligibility und Freischaltung bei Stripe klären (Live-Konto nötig? Sandbox-Test möglich?)
- Rechtliche/steuerliche Auswirkung des Händlerwechsels bewerten (externe Beratung)
- Entscheidung als ADR (Nachtrag zu ADR-0002) festhalten; danach Umsetzung als eigenes Ticket
- Bis dahin: Checkout wirbt nicht mit PayPal (erledigt in #191/#192)

## Akzeptanzkriterien

- [ ] Stripe-Freischaltung geklärt und dokumentiert
- [ ] ADR mit Entscheidung (PayPal ja/nein, Modell)
- [ ] Bei "ja": Umsetzungsticket inkl. Tests (Checkout, Webhook, Erstattung)
