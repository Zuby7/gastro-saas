# Troubleshooting

Real problems hit while building and deploying this project, as symptom -> cause -> fix. Background and dates: [deployment-strategy.md](deployment-strategy.md). Stripe setup: [runbook-stripe-test-mode.md](runbook-stripe-test-mode.md).

## Hosted database

### Migration drift: code deployed, migrations not applied

- **Symptom**: a feature works locally but fails on the hosted app, e.g. Postgres `23502` (not-null violation) on `payment_accounts.stripe_account_id`, or a REST probe of a new table/RPC returns 404.
- **Cause**: migrations are not applied to the hosted Supabase project automatically, and no CI job compares them. Once, every migration from `20260820090000` onward was missing while the matching code was live. `supabase_migrations.schema_migrations` is not exposed via PostgREST, so you cannot read applied versions through the API.
- **Fix**: probe representative tables/RPCs via REST (200 versus 404) to find the gap, concatenate the missing migration files in filename order into one script and run it in the Supabase SQL Editor (or `supabase link` + `supabase db push` with an access token and the DB password). Do this **before** deploying code that needs them. Open follow-up: a release-check step comparing the repo's migration list to the hosted project. Migrations against production need explicit approval.

### Check-constraint violation on a hand-written row (`payment_accounts.status`)

- **Symptom**: `23514 new row ... violates check constraint` when inserting or updating `payment_accounts` manually (SQL editor).
- **Cause**: `status` only allows `pending`, `restricted` or `enabled` (`enabled`, not "active"/"complete"). Similar closed sets exist elsewhere (`payments.status`: `pending/paid/failed/cancelled/flagged_for_review`; `refunds.status`: `pending/succeeded/failed/unconfirmed`).
- **Fix**: use an allowed value, or let the Connect webhook / return page set it. Prefer the app flow over manual writes.

### Seeded fake Stripe account makes checkout fail generically

- **Symptom**: checkout fails with a generic error even though the tenant looks `enabled`.
- **Cause**: the demo seed's `payment_accounts` row uses the fake id `acct_demo_seed_test` with `charges_enabled: true`; with a real Stripe key every Stripe call for that account fails.
- **Fix**: remove or replace the row with a real connected test account; never seed fake ids where a real key is configured.

## Cloudflare Workers

### Every request returns 500: "Dynamic require of middleware-manifest.json is not supported"

- **Cause**: `next@16.2.12` `getMiddlewareManifest()` uses a raw `require()`, unsupported in workerd (upstream opennextjs-cloudflare#1380).
- **Fix**: the repo carries `patches/next@16.2.12.patch` (`pnpm patch`, listed in `pnpm-workspace.yaml`). Keep it when changing `next`; rebuild with `build:cf`. A bare `pnpm install` without the patch reintroduces the bug.

### Stripe calls fail with "An error occurred with our connection to Stripe"

- **Symptom**: every Stripe API call fails on the Worker after silent retries, but works locally.
- **Cause**: the Stripe SDK's default HTTP client uses Node `https`, which workerd does not support.
- **Fix**: `createStripeClient()` passes `httpClient: Stripe.createFetchHttpClient()` (PR #151). Always build the client through that factory. Same bug class as the middleware patch and `sharp` -> `@cf-wasm/photon`: do not introduce dependencies that need Node sockets or the filesystem.

### Stripe redirects back to `http://localhost:3000` (`ERR_CONNECTION_REFUSED`)

- **Symptom**: the test payment succeeds at Stripe but the customer returns to localhost; same for Connect onboarding return.
- **Cause**: `NEXT_PUBLIC_APP_URL` was unset on the Worker; `lib/payments/service.ts`, `app/account/payments/actions.ts` and `app/account/actions.ts` fall back to localhost (issue #157).
- **Fix**: it is a plain `vars` entry in `apps/web/wrangler.jsonc`; set it to the real public base URL (no trailing slash) and redeploy. When the domain changes, update it and the Stripe webhook endpoints together.

### Menu/dish view statistics silently stop

- **Cause**: `IP_HASH_SECRET` is not set as a Worker secret in production; all `record_*` analytics calls are skipped with only a `console.warn`.
- **Fix**: `wrangler secret put IP_HASH_SECRET` (stdin), then deploy. Order for the purge schedule is in deployment-strategy.md.

### `wrangler tail` / `wrangler secret` fails with an authentication error

- **Symptom**: wrangler rejects `CLOUDFLARE_API_TOKEN` although the token is valid, or `source .env` in bash prints "command not found" with the token text.
- **Cause**: a stray space after `=` in the `.env` line (`CLOUDFLARE_API_TOKEN= abc...`). Bash tries to execute the token as a command (which also echoes it to your terminal), and other parsers keep the leading space as part of the value.
- **Fix**: write `CLOUDFLARE_API_TOKEN=abc...` with no space after `=`; do not `source` the file, pass the token as a process environment variable to the child process. If a token was echoed anywhere, rotate it in the Cloudflare dashboard. Never print tokens in logs or chat.

## Stripe

### Invalid API key although it looks right

- **Cause**: key transcribed from a screenshot (look-alike characters `w`/`W`, `J`/`j`, `B`/`8`), or a live key (`sk_live_`), which the app refuses by design.
- **Fix**: copy the text from the Dashboard, check it with `GET https://api.stripe.com/v1/balance` (expect `livemode: false`), then store it. Messages from `createStripeClient()`: "STRIPE_SECRET_KEY must be set" or "must be a Stripe TEST MODE key".

### Onboarding fails: "Stripe no longer recommends Accounts v1"

- **Cause**: the platform has Accounts v1 disabled (default for new platforms).
- **Fix**: enable Dashboard -> Settings -> Account features -> "Support für Accounts v1" in test mode.

### Onboarding keeps failing after the toggle was fixed

- **Cause**: idempotency-key replay. The key `stripe-express-account:<tenantId>` caches the **error** response for 24 hours.
- **Fix**: wait 24 hours, or create the Express account separately with a different key and write its id into `payment_accounts.stripe_account_id`. See the runbook.

### Payment succeeds at Stripe but the order stays `awaiting_payment`

- **Check**: the webhook never arrived or was rejected. Verify the payment-events endpoint exists and points at the live URL, that `STRIPE_WEBHOOK_SECRET` is the secret of **that** endpoint (not the Connect one), and the delivery log in the Dashboard (400 means a signature problem; 500 means processing failed and Stripe will retry). If `payments.status = 'flagged_for_review'`, an amount, tenant or after-cancellation mismatch was detected on purpose: investigate, never force-mark paid.

## Git, CI and Windows

### `Format Check` fails in CI although it looks fine locally (CRLF)

- **Symptom**: `prettier --check` reports files that you did not intend to change; Git warns `LF will be replaced by CRLF`.
- **Cause**: Windows checkouts/editors write CRLF; Prettier 3 defaults to LF and CI runs on Linux.
- **Fix**: run `npx prettier --write <files you changed>` (normalizes to LF) and check with `npx prettier --check <files>` before pushing. The warnings themselves are harmless. Do not run `prettier --write .` and commit unrelated reformatting.

### `pnpm` not found / Corepack EPERM on Windows

- **Fix**: use `npx pnpm <command>`, or install with `npm install -g pnpm` and add `%APPDATA%\npm` to `PATH` (see [assumptions.md](../decisions/assumptions.md)).

### PR is "behind" main and cannot merge

- **Symptom**: GitHub shows "This branch is out-of-date with the base branch" and the merge button is blocked, even though checks were green.
- **Cause**: branch protection on `main` requires up-to-date branches (`strict: true`, also for admins) plus the seven required checks (Format Check, Lint, Typecheck, Unit Tests, Build, Secret Scan, Migration Validation). Every time another PR merges, yours falls behind. Also: merge itself is only allowed after the epic's Opus `APPROVED` verdict ([contributing-workflow.md](../development/contributing-workflow.md)).
- **Fix**: update the branch (`git fetch origin && git merge origin/main`, or GitHub's "Update branch"), push, wait for CI to re-run green, then merge. Resolve conflicts locally; never bypass protection.

### Migration Validation fails in CI

- **Cause**: a migration does not apply on a fresh `supabase start`, `supabase db lint` finds an issue, or an integration/RLS test fails. The job runs on every PR (no path filter, because it is a required check).
- **Fix**: reproduce locally with `db:reset`, then `pnpm --filter @gastro-saas/database test:integration`. Never edit an already-merged migration that has been applied to the hosted project; add a new one.

### Seed script refuses to run

- **Symptom**: `insufficient_privilege` exception mentioning `gastro_saas.allow_demo_seed`.
- **Cause**: intentional guard; the seed creates users with a public password.
- **Fix**: use `pnpm --filter @gastro-saas/database db:reset` or `db:seed`, which set the session flag. Never run it against a hosted project.

### Stale `.next` cache breaks `build:cf`

- **Fix**: delete `apps/web/.next` (left over from `next dev`) and `apps/web/.open-next`, then rebuild.
