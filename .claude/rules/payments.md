---
description: Payment rules — Stripe Connect
paths: ["packages/domain/payments/**"]
---

- Never store raw card numbers or CVCs. Never log payment secrets. Never expose Stripe secret keys to the browser.
- The server always recalculates the complete order total before creating a payment — a client-submitted total or amount is never trusted.
- An order becomes "paid" only via a verified, idempotent Stripe webhook (signature check + `payment_webhook_events` dedup by event ID) — never from a client-side redirect/success page alone.
- Refunds require an explicit `payments.refund` permission, always go through a server-side provider call, and always write an audit entry (actor, amount, reason, provider reference, timestamp). A refund can never exceed the paid amount.
- Everything runs in Stripe **test mode** until the user explicitly authorizes production activation — this is a hard gate, not a default to flip casually.
- Track Stripe Connect onboarding status (`charges_enabled`, `payouts_enabled`, restricted) per tenant; don't assume onboarding is complete.
