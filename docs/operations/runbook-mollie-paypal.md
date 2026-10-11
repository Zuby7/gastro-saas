# Runbook: PayPal via Mollie, test mode, end to end

Scope: set up and verify PayPal payments through Mollie Connect in **test mode**, locally and on the deployed Worker. Decision and security model: [ADR-0004](../architecture/adr/0004-paypal-via-mollie-connect-platforms.md) (PROPOSED). Rules: `.claude/rules/payments.md` (Mollie clause). Problems: [troubleshooting.md](troubleshooting.md).

The code was written against docs.mollie.com but has **not yet been run against the real Mollie API**. This runbook is also the verification checklist; note any deviation you find.

## Forbidden

- Live mode. Leave `MOLLIE_LIVE_ALLOWED` unset. Production activation needs explicit written approval from the owner.
- Putting `MOLLIE_CLIENT_SECRET` or `MOLLIE_TOKEN_KEY` in the browser, commits, logs or chat; use `wrangler secret put <NAME>` (stdin) for the Worker.
- Marking an order paid anywhere except the verified Mollie webhook path.

## 1. Mollie account and partner access

1. Sign up at mollie.com with the platform's company data (test mode is available without full onboarding).
2. Request **Connect for Platforms / partner access** from Mollie. A partner account and a registered OAuth app are required. Approval process and timeline are an open question (ADR-0004).
3. In the Mollie Dashboard under Developers, register an **OAuth app**:
   - Redirect URL: `<NEXT_PUBLIC_APP_URL>/account/payments/mollie/callback` (exact match; locally `http://localhost:3000/account/payments/mollie/callback` if Mollie allows it, otherwise use a tunnel and set `NEXT_PUBLIC_APP_URL` to it).
   - Copy the client id and secret.

## 2. Configuration

1. Generate the token key: `openssl rand -base64 32`.
2. Local: put `MOLLIE_CLIENT_ID`, `MOLLIE_CLIENT_SECRET`, `MOLLIE_TOKEN_KEY` in `apps/web/.env.local`. Deployed: `wrangler secret put` for each.
3. Leave `MOLLIE_LIVE_ALLOWED` unset (test mode).
4. Mollie must reach `<NEXT_PUBLIC_APP_URL>/api/webhooks/mollie` from the internet (the payment's `webhookUrl`). Locally use a tunnel.
5. Apply the migration `20260910090000_mollie_connect_paypal.sql`.

## 3. Restaurant steps (also in the onboarding guide)

1. The restaurant has (or creates) its own Mollie account. In test mode the Mollie test profile is enough.
2. In **its** Mollie dashboard: Settings > Payment methods > PayPal > "Connect with PayPal" (a PayPal business account is needed; in test mode the sandbox flow applies).
3. In the app, as Owner: Zahlungen > "PayPal über Mollie verbinden" > log in at Mollie > grant access.
4. Back on the Zahlungen page the status must read "Verbunden, PayPal aktiv". If it says "PayPal noch nicht aktiviert", finish step 2, then click "PayPal-Status prüfen".

## 4. Test purchase

1. Open the restaurant's public menu, add items, go to the checkout. The "Zahlungsart" choice (Karte, Klarna, Apple Pay und weitere / PayPal) must be visible.
2. Choose PayPal, submit. You are redirected to Mollie's test checkout; pick "paid".
3. Mollie calls `/api/webhooks/mollie`; the order must move to `received` and the receipt must read "Online bezahlt (PayPal)". Redirecting back alone must **not** mark it paid: try the "failed" and "cancelled" test outcomes and an abandoned payment too (order stays `awaiting_payment`, then the timeout sweep cancels it).
4. Refund: Bestellung > Rückerstattung. The refund is created on the restaurant's Mollie payment.
5. Replay the webhook (`curl -d id=tr_xxx .../api/webhooks/mollie`): nothing must change.

## 5. Things to verify against the real API

- OAuth scopes (`payments.read/write`, `refunds.read/write`, `profiles.read`, `organizations.read`) are sufficient and accepted.
- `GET /v2/profiles/me`, `GET /v2/organizations/me` and `GET /v2/methods?profileId=...&testmode=true` work with the OAuth token; the PayPal detection uses the methods list.
- `POST /v2/payments` with `profileId`, `testmode: true`, `method: ["paypal"]` and the `Idempotency-Key` header.
- The token revoke call used on disconnect (`DELETE /oauth2/tokens`) works; failure is non-fatal.
- Mollie refund ids start with `re_` (they are stored in `refunds.stripe_refund_id`, which checks `^re_`).

## 6. Operations

- Payment flagged for review (`payments.status = 'flagged_for_review'`): see `docs/operations/refund-reconciliation.md`; check the audit log entry (`payment_amount_mismatch_flagged`, `payment_webhook_tenant_mismatch_flagged`, `payment_after_order_cancelled_flagged`) and the Mollie dashboard.
- A restaurant shows "Verbindung abgelaufen": Mollie rejected the token refresh; the restaurant reconnects.
- Rotating `MOLLIE_TOKEN_KEY` invalidates all stored connections; every restaurant must reconnect.
