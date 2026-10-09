# Runbook: Stripe test mode, end to end

Scope: set up and verify Stripe Connect payments in **test mode** locally and on the deployed Worker. Account model: [ADR-0002](../architecture/adr/0002-stripe-connect-account-model.md) (Express accounts, destination charges with `on_behalf_of`, no application fee). Rules: `.claude/rules/payments.md`. History of the first real setup: [deployment-strategy.md](deployment-strategy.md) ("Stripe test-mode go-live"). Problems: [troubleshooting.md](troubleshooting.md).

## Forbidden

- Live keys. `createStripeClient()` (`apps/web/src/lib/stripe/client.ts`) throws for any `STRIPE_SECRET_KEY` that does not start with `sk_test_` or `rk_test_`. Do not weaken or bypass this gate. Production activation needs explicit written approval from the owner.
- Storing card data, trusting the success redirect as proof of payment, or marking an order paid anywhere except the verified webhook.
- Putting keys in the browser, in commits, in logs, in chat, or as CLI arguments (`wrangler secret put <NAME>` reads the value from stdin).
- Seeding fake `acct_...` ids into any environment that has a real Stripe key (the local demo seed's `acct_demo_seed_test` is for UI browsing only).

## 1. Keys

1. In the Stripe Dashboard, switch to **test mode** (sandbox) and copy the secret key (`sk_test_...`) from Developers -> API keys.
2. Do not retype a key from a screenshot: look-alike characters (`w`/`W`, `J`/`j`, `B`/`8`) produced an invalid key once. Copy the text, then verify before storing it:
   `GET https://api.stripe.com/v1/balance` with the key as bearer token must return `livemode: false`.
3. Local: put it in `apps/web/.env.local` as `STRIPE_SECRET_KEY`. Deployed: `wrangler secret put STRIPE_SECRET_KEY` (stdin).

## 2. Accounts v1 support toggle

New Stripe platforms have `POST /v1/accounts` disabled by default ("Stripe no longer recommends Accounts v1"). Onboarding uses `type: "express"` via the v1 API, so enable it once per platform in test mode: Dashboard -> Settings -> Account features -> **"Support für Accounts v1"** (English UI: support for Accounts v1). Without it, tenant onboarding fails with an error from `accounts.create`. Follow-up before any production activation: evaluate migrating to the Accounts v2 API.

## 3. Webhooks (two endpoints, two secrets)

Two distinct endpoints, each with its own signing secret. They are not interchangeable.

| Endpoint path                  | Env var                         | Events                                                                                    | Notes                                                                |
| ------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `/api/webhooks/stripe`         | `STRIPE_WEBHOOK_SECRET`         | `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed` | Platform-account events (destination charges)                        |
| `/api/webhooks/stripe-connect` | `STRIPE_CONNECT_WEBHOOK_SECRET` | `account.updated`                                                                         | Create it as a **Connect** endpoint ("events on connected accounts") |

Deployed: Dashboard -> Developers -> Webhooks -> add endpoint `https://<NEXT_PUBLIC_APP_URL host>/api/webhooks/stripe` (and the `stripe-connect` one), copy each `whsec_...`, then `wrangler secret put STRIPE_WEBHOOK_SECRET` and `wrangler secret put STRIPE_CONNECT_WEBHOOK_SECRET`. If the public URL changes (custom domain), update both endpoints in the same change.

Local with Stripe CLI (each command prints its own `whsec_...` to put in `apps/web/.env.local`):

```bash
stripe listen --events checkout.session.completed,checkout.session.expired,payment_intent.payment_failed --forward-to localhost:3000/api/webhooks/stripe
stripe listen --events account.updated --forward-to localhost:3000/api/webhooks/stripe-connect
```

Both routes verify the signature against the raw body and deduplicate by event id (`payment_webhook_events`, `claim_payment_webhook_event()`); duplicates return 200 with `duplicate: true`.

## 4. Public URL

`NEXT_PUBLIC_APP_URL` (no trailing slash) builds the Checkout `success_url`/`cancel_url` and the Connect return/refresh URLs. Locally it defaults to `http://localhost:3000`; on the Worker it is a plain `vars` entry in `apps/web/wrangler.jsonc`. If it is missing on the Worker, Stripe redirects the customer to `localhost`.

## 5. Connect onboarding of a tenant

1. Sign in as Owner (or any role with `payments.connect`), open `/account/payments`, start onboarding. The server creates an Express account (`country: DE`, `card_payments` and `transfers` capabilities, `metadata.tenant_id`) and a Stripe-hosted Account Link, then redirects.
2. Complete the hosted form. In test mode use Stripe's "use test data" path.
3. Stripe sends `account.updated` to the Connect endpoint; `apply_connect_account_snapshot()` updates `payment_accounts` (`pending` / `restricted` / `enabled`, `charges_enabled`, `payouts_enabled`). The return page (`/account/payments/return`) also re-fetches the account from Stripe server-side and updates the row, because Stripe does not guarantee verification is finished at redirect time; it never trusts query parameters. Checkout is refused (`isTenantChargeReady`) until `charges_enabled` is true.

**Idempotency-key caveat.** Account creation sends `Idempotency-Key: stripe-express-account:<tenantId>`. Stripe caches the response for 24 hours, **including an error response**. If creation failed (e.g. Accounts v1 not yet enabled) and you fix the cause, retries within 24 hours replay the cached error. Workaround used so far: create the Express account in the Dashboard/API with a different key and write its id into `payment_accounts.stripe_account_id` via the SQL editor, or wait 24 hours. Open follow-up: do not reuse a key whose cached outcome was an error.

**Express versus custom test account for the demo tenant.** Express accounts cannot be pre-filled via the API, so completing hosted onboarding is manual. The hosted demo tenant (`trattoria-da-mario`) instead points at a fully enabled Stripe **custom** test account created for testing. Real tenants always use Express onboarding. Hosted `payment_accounts` rows must not contain fake ids (see Forbidden).

## 6. Test cards

Any future expiry, any CVC, any postcode:

| Card                  | Outcome                           |
| --------------------- | --------------------------------- |
| `4242 4242 4242 4242` | Succeeds                          |
| `4000 0000 0000 0002` | Declined                          |
| `4000 0025 0000 3155` | Requires 3D Secure authentication |

## 7. Verify the payment path (manual end-to-end check)

There is no automated Stripe e2e test (Playwright covers only register/login). Verify manually, locally with `stripe listen` running or on the Worker:

1. Open `/r/<slug>` of a tenant whose `payment_accounts` is `enabled` (`charges_enabled`), add a dish, go to checkout, fill the form, submit.
2. You land on Stripe Checkout; pay with `4242 4242 4242 4242`.
3. Stripe redirects to `/r/<slug>/orders/<token>?checkout=success`. Within seconds the page shows "Bestellung eingegangen" once the webhook was processed. Before that it shows the awaiting-payment state: the redirect alone changes nothing.
4. The receipt link (`/beleg`) appears for the paid order.
5. In the database: `payments.status = 'paid'`, `orders.status = 'received'`, one row in `payment_webhook_events` with `processed_at` set. In the staff dashboard `/account/orders` the order shows up.
6. Refund check: as a role with `payments.refund`, refund the order from `/account/orders/<id>`; `refunds.status` becomes `succeeded`.
7. Negative checks worth doing after changes to payment code: decline card (order stays `awaiting_payment`, then cancelled by the timeout sweep after 30 minutes), replay a webhook with the Dashboard "resend" (returns `duplicate: true`), send a request with a bad signature (400).

If step 3 never completes, see [troubleshooting.md](troubleshooting.md) (wrong webhook secret, endpoint not reachable, localhost redirect).

## Related

- Stuck refunds: [refund-reconciliation.md](refund-reconciliation.md).
- Live-mode switch is a separate, explicitly approved project; it also needs a decision on MFA for Owner/Manager ([assumptions.md](../decisions/assumptions.md)) and dispute handling (ADR-0002).
