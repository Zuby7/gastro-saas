## Problem

PayPal-Zahlungen ueber Mollie (#195, ADR-0004) haben keinen auf 30 Minuten abgestimmten Ablauf: Mollies expiresAt ist (laut Dokumentation, ungeprueft) frueh nur mit Mindestdatum morgen nutzbar. Storniert der Awaiting-Payment-Sweep eine Bestellung nach 30 Minuten, kann die Mollie-Zahlung weiter offen sein und spaeter bezahlt werden. Der Webhook markiert so eine Zahlung dann als payment_after_order_cancelled_flagged (manuelle Pruefung/Erstattung), verhindert aber nicht, dass der Gast zahlt.

## Vorschlag

- Wenn der Sweep eine Bestellung mit offener Mollie-Zahlung storniert, die Zahlung bei Mollie abbrechen (DELETE /v2/payments/{id}, mit dem Token des Restaurants, nur fuer Status open).
- Test: Sweep storniert, Mollie-Abbruch wird aufgerufen, bezahlte Zahlung wird nicht abgebrochen.

## Akzeptanzkriterien

- [ ] Offene Mollie-Zahlungen stornierter Bestellungen werden abgebrochen
- [ ] Fehler beim Abbrechen blockieren den Sweep nicht und werden geloggt
- [ ] Doku (ADR-0004, Runbook) aktualisiert
