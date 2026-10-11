---
description: Payment rules - Stripe Connect
paths: ["packages/domain/payments/**", "apps/web/src/lib/mollie/**", "apps/web/src/lib/payments/**"]
---

- Never store raw card numbers or CVCs. Never log payment secrets. Never expose Stripe secret keys to the browser.
- The server always recalculates the complete order total before creating a payment - a client-submitted total or amount is never trusted.
- An order becomes "paid" only via a verified, idempotent Stripe webhook (signature check + `payment_webhook_events` dedup by event ID) - never from a client-side redirect/success page alone.
- Refunds require an explicit `payments.refund` permission, always go through a server-side provider call, and always write an audit entry (actor, amount, reason, provider reference, timestamp). A refund can never exceed the paid amount.
- Everything runs in Stripe **test mode** until the user explicitly authorizes production activation - this is a hard gate, not a default to flip casually.
- Track Stripe Connect onboarding status (`charges_enabled`, `payouts_enabled`, restricted) per tenant; don't assume onboarding is complete.
- Account/charge model: Express accounts, destination charges with `on_behalf_of` - see ADR-0002. Webhooks arrive on the platform account; resolve the tenant from the event's connected-account reference, never assume a 1:1 platform-account-to-tenant mapping.
- Amount mismatch between the webhook event and the order's server-calculated total is never resolved by trusting the webhook amount: leave the order unpaid, flag it for manual review, and alert - do not guess which value is right.
- An order left in `awaiting_payment` past a configurable timeout (default: 30 minutes) transitions to `cancelled` automatically, so it stops inflating "open orders" dashboards and stops blocking availability.

## Mollie clause (PayPal via Mollie Connect, issue #195, ADR-0004)

This clause ADDS to the rules above; it does not relax any Stripe rule. It applies to code touching `apps/web/src/lib/mollie/**`, `lib/payments/mollie-*`, `app/api/webhooks/mollie/**`.

- The restaurant is the Mollie merchant of record; the platform only holds OAuth tokens granted by the restaurant. Tokens are stored AES-256-GCM encrypted (`MOLLIE_TOKEN_KEY`, fail closed when unset), never in plaintext, never in the browser, never in logs/audit metadata/error messages, and the token table has no grants for `anon`/`authenticated`.
- Mollie's webhook is unsigned and carries only `id`. The Mollie equivalent of the Stripe webhook rule: an order becomes "paid" only after the server fetched the payment from Mollie with that restaurant's own token and verified status `paid`, amount and currency equal to the order's server-calculated total, `metadata.orderId`/`tenantId` equal to our `payments` row, and a matching profile -- then via the same atomic `mark_order_received_and_paid` RPC. Idempotency comes from that state machine (only a `pending` payment of an `awaiting_payment` order transitions). Any mismatch leaves the order unpaid and flags it for review. Unknown ids get a neutral 200.
- Mollie payments use `testmode: true` unless `MOLLIE_LIVE_ALLOWED === '1'`; a live payment seen while live is not allowed is flagged, never accepted. Production activation needs explicit user approval, like Stripe.
- Refunds for Mollie payments go through the Mollie refunds API with the same `payments.refund` permission, reservation row, idempotency key, `finalize_refund` state machine and audit entry; an ambiguous failure becomes `unconfirmed`.
