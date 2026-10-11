# ADR-0004: PayPal via Mollie Connect for Platforms

- Status: PROPOSED
- Date: 2026-10-11
- Issue: #195
- Not legal advice. An external review of the Mollie (and PayPal) contract terms is recommended before any production activation.

## Context

Restaurants want to offer PayPal. Stripe stays the default for cards, Klarna and Apple Pay ([ADR-0002](0002-stripe-connect-account-model.md)). Options for PayPal:

- **Stripe + PayPal:** with Connect, Stripe supports PayPal only with the platform as the merchant (findings in #193). That would make the platform the merchant of record for PayPal sales, which we do not want.
- **PayPal directly with each restaurant's own REST credentials (client id/secret):** PayPal documents this only for a single merchant's own integration. For platforms with many merchants PayPal points to its partner programme (Partner Referrals, PayPal-Auth-Assertion). Collecting many merchants' secrets would also make us responsible for storing them.
- **Mollie Connect for Platforms (OAuth):** each restaurant is its own Mollie merchant and merchant of record, Mollie does KYB, first-line refund/chargeback liability sits with the merchant (Mollie's terms), and PayPal is a payment method each merchant activates in their own Mollie dashboard (Settings > Payment methods > PayPal > "Connect with PayPal", PayPal business account required). Funds go to the merchant, not through the platform.

## Decision

Offer PayPal through Mollie, platform model:

- The platform holds a Mollie **partner account with a registered OAuth app** (`MOLLIE_CLIENT_ID`, `MOLLIE_CLIENT_SECRET`). Each restaurant connects its own Mollie account through OAuth; the platform stores that restaurant's tokens and creates payments **with the restaurant's own access token**. The platform never holds the funds.
- **Merchant of record = the restaurant.** Refunds are issued by the restaurant (through our UI, on the restaurant's Mollie payment); chargebacks are the restaurant's.
- Stripe is unchanged. Checkout shows a payment-method choice (Stripe default / PayPal) only when the server sees a connected Mollie account with PayPal enabled; the checkout action validates the method server-side.
- `payments` gains `provider` (`stripe` | `mollie`) and `mollie_payment_id`; the existing amount/tenant guard trigger covers both providers.

### Token storage security

- Tokens are encrypted with AES-256-GCM (WebCrypto, Workers-compatible) using `MOLLIE_TOKEN_KEY` (32 random bytes, Worker secret). The tenant id and token kind are bound in as additional authenticated data, so a ciphertext copied to another row fails to decrypt. Missing or malformed key: every operation fails closed.
- `tenant_mollie_accounts` has RLS enabled, **no policies and no grants for `anon`/`authenticated`**; only `service_role` server code reads/writes. Members see only non-secret status through the SECURITY DEFINER RPC `get_mollie_connection_status()` (requires `payments.read`).
- OAuth connect: `payments.connect` (Owner) only; `state` is HMAC-signed, expires after 10 minutes and is bound to tenant and user, plus a single-use httpOnly nonce cookie. Tenant and user always come from the session.
- Tokens never appear in logs, audit metadata, error messages or redirects. Disconnect revokes at Mollie (best effort) and deletes the row. A refresh Mollie rejects flips the row to `needs_reauth` and PayPal disappears from checkout.
- Rotating `MOLLIE_TOKEN_KEY` invalidates all stored connections; restaurants must reconnect.

### Webhook verification (the Mollie equivalent of the Stripe webhook rule)

Mollie's webhook is unsigned and POSTs only `id=<paymentId>`. Nothing in the request is trusted. The server looks up its own `payments` row for that id, loads that tenant's token (refreshing if needed), **fetches the payment from Mollie** and only then, if status is `paid`, amount and currency equal the order's server-calculated total, `metadata.orderId`/`tenantId` match our row, the profile matches the tenant's, the method is PayPal and the mode is test (unless live is explicitly allowed), marks the order received through the same atomic `mark_order_received_and_paid` RPC as Stripe. Any mismatch flags the payment for manual review and leaves the order unpaid. Replays are no-ops because only a `pending` payment of an `awaiting_payment` order can transition. Unknown or malformed ids get a neutral 200 (no information leak); unexpected failures return 5xx so Mollie retries.

### Test/live gate

Payments are created and fetched with `testmode: true` unless `MOLLIE_LIVE_ALLOWED === '1'`. Production activation needs explicit approval, same as Stripe.

## Consequences

- Restaurants need their own Mollie account plus a PayPal business account; onboarding docs and the runbook ([runbook-mollie-paypal.md](../../operations/runbook-mollie-paypal.md)) say so.
- No confirmation e-mail for PayPal orders: Mollie does not report the payer's e-mail and orders store none. Order status and receipt work normally.
- Refunds for Mollie payments reuse the refund state machine; Mollie refund ids (`re_...`) are stored in `refunds.stripe_refund_id`.
- A second webhook endpoint (`/api/webhooks/mollie`) and a second set of secrets to operate.
- Merchant-side obligations (refunds, chargebacks, fees of PayPal + 0.10 EUR per payment) are the restaurant's, not the platform's.

## Open questions

- **Mollie partner approval:** a partner account and OAuth app are required; the approval process and timeline are unclear.
- Conditions and merchant eligibility (EEA/UK/CH) in the Mollie contract need external review.
- The implementation is written against docs.mollie.com but has not been exercised against the real Mollie API (no credentials existed); endpoints, scopes and the methods lookup must be verified in the Mollie sandbox (see the runbook).
- Optional follow-up: collect an e-mail at checkout for PayPal orders to enable the confirmation mail.
