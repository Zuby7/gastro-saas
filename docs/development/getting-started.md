# Getting started (local development)

## Prerequisites

- Node.js >= 20 and pnpm 10 (`packageManager` in the root `package.json`). On Windows `pnpm` may not be on `PATH`: use `npx pnpm <command>` or `corepack enable`.
- Docker (Desktop on Windows/macOS). The local Supabase stack (Postgres, Auth, Storage, Studio) runs in Docker; unit tests do not need it, but `db:*`, integration tests, e2e tests and the seeded demo tenant do.
- Optional: Stripe CLI (to forward test webhooks locally), a Stripe test-mode account (see [runbook-stripe-test-mode.md](../operations/runbook-stripe-test-mode.md)).

## First run

```bash
pnpm install
cp .env.example apps/web/.env.local
pnpm --filter @gastro-saas/database db:start    # supabase start; applies all migrations
pnpm --filter @gastro-saas/database db:reset    # clean DB + migrations + demo seed
node supabase/seed-assets/upload-dish-media.mjs # upload the demo dish photos to Storage
pnpm dev                                        # http://localhost:3000
```

Next.js reads `apps/web/.env.local`. The Supabase values in `.env.example` are Supabase's well-known local defaults (not secrets) and work as-is against the local stack. Studio runs on <http://127.0.0.1:54323>. Local Auth runs with `enable_confirmations = false`, so registering gives an immediate session.

## Environment variables

Source of truth: `.env.example` (never commit real values; `.env*` is hook-blocked). Variables marked "Worker secret" are set on the Cloudflare Worker with `wrangler secret put <NAME>` (value via stdin, never as a CLI argument).

| Variable                        | Scope                      | Purpose                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | public, build-time         | Supabase API URL (`http://127.0.0.1:54321` locally). Inlined into the bundle at build time                                                                                                                                                         |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public, build-time         | Anon key; browser-safe, still governed by RLS                                                                                                                                                                                                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | server only, Worker secret | Bypasses RLS. Only used in `apps/web/src/lib/supabase/admin.ts` for guest/webhook paths. Never `NEXT_PUBLIC_`                                                                                                                                      |
| `SUPABASE_DB_URL`               | tooling only               | Direct Postgres URL for the seed runner and integration tests (`postgresql://postgres:postgres@127.0.0.1:54322/postgres` locally)                                                                                                                  |
| `SUPABASE_JWT_SECRET`           | tooling only               | Local JWT secret (local default only)                                                                                                                                                                                                              |
| `STRIPE_SECRET_KEY`             | server only, Worker secret | Must start with `sk_test_` or `rk_test_`; `createStripeClient()` throws for anything else                                                                                                                                                          |
| `STRIPE_WEBHOOK_SECRET`         | server only, Worker secret | Signing secret (`whsec_...`) of the payment-events endpoint `/api/webhooks/stripe`                                                                                                                                                                 |
| `STRIPE_CONNECT_PAYPAL_ENABLED` | server only, optional      | `1` = Checkout Sessions are created without `on_behalf_of` and the checkout hint mentions PayPal (ADR-0003, PROPOSED). Anything else/unset = off (default). Do not enable before Stripe has enabled PayPal with Connect                            |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | server only, Worker secret | Signing secret of the Connect endpoint `/api/webhooks/stripe-connect` (`account.updated`). A different secret from the one above                                                                                                                   |
| `IP_HASH_SECRET`                | server only, Worker secret | Key for the HMAC of visitor IPs used by menu analytics (issue #164). Optional in dev/test; in production its absence disables all menu-view/dish-view/add-to-cart recording (only a `console.warn`)                                                |
| `RESEND_API_KEY`                | server only, Worker secret | Transactional email (staff invitations, order confirmation). If unset, sending is skipped with a log line                                                                                                                                          |
| `RESEND_FROM_EMAIL`             | server only                | From address; defaults to Resend's sandbox address                                                                                                                                                                                                 |
| `NEXT_PUBLIC_APP_URL`           | public                     | Public base URL without trailing slash. Used for Stripe success/cancel/return URLs, invite links and QR codes. Defaults to `http://localhost:3000` when unset. On Cloudflare it is a plain `vars` entry in `apps/web/wrangler.jsonc`, not a secret |

If `NEXT_PUBLIC_APP_URL` is unset on a deployed Worker, Stripe redirects back to `localhost` (see [troubleshooting](../operations/troubleshooting.md)).

For Stripe locally, either use the Stripe CLI (`stripe listen --events checkout.session.completed,checkout.session.expired,payment_intent.payment_failed --forward-to localhost:3000/api/webhooks/stripe` and `stripe listen --events account.updated --forward-to localhost:3000/api/webhooks/stripe-connect`, as given in `.env.example`; each listener prints its own `whsec_` value) or point Dashboard endpoints at a tunnel. Details in the Stripe runbook.

## Demo seed data

`supabase/seed.sql` seeds one persistent demo tenant, "Trattoria Da Mario" (slug `trattoria-da-mario`, public menu at `/r/trattoria-da-mario`), with 4 categories, 12 dishes (variants, an option group, allergens, one sold-out dish), 5 orders covering every status (with matching paid payments and one partial refund) and one pending invitation.

| Login                           | Role      | Password            |
| ------------------------------- | --------- | ------------------- |
| `owner@trattoria-demo.test`     | Owner     | `DemoPasswort1234!` |
| `manager@trattoria-demo.test`   | Manager   | `DemoPasswort1234!` |
| `kitchen@trattoria-demo.test`   | Kitchen   | `DemoPasswort1234!` |
| `service@trattoria-demo.test`   | Service   | `DemoPasswort1234!` |
| `marketing@trattoria-demo.test` | Marketing | `DemoPasswort1234!` |

How it is guarded: the seed creates `auth.users` with a public password, so it refuses to run unless the Postgres session setting `gastro_saas.allow_demo_seed = 'on'`. Only `packages/database/scripts/run-local-seed.mjs` sets it (used by `db:reset` and `db:seed`). Running `seed.sql` any other way (bare `psql`, a hosted SQL editor) fails on purpose. The seed no-ops if the slug already exists.

Caveats:

- The seeded `payment_accounts` row uses the fake Stripe id `acct_demo_seed_test` with status `enabled`. That is fine for browsing the UI locally, but real Stripe calls against it fail generically. Do not seed fake Stripe ids into any environment that has a real Stripe key; for a real test-mode checkout use a real connected test account (see the runbook).
- Dish photos live in Supabase Storage, not Postgres; `db:reset` does not touch them. Re-run `node supabase/seed-assets/upload-dish-media.mjs` after a reset if photos are missing.
- Never run the seed against a hosted project.

## Running tests

| Kind                 | Command                                                | Needs                                               |
| -------------------- | ------------------------------------------------------ | --------------------------------------------------- |
| Unit (all packages)  | `pnpm test`                                            | nothing (jsdom, mocked Supabase/Stripe)             |
| Unit with coverage   | `pnpm --filter @gastro-saas/web test:coverage`         | nothing                                             |
| DB / RLS integration | `pnpm --filter @gastro-saas/database test:integration` | local Supabase running (`db:start`), real Postgres  |
| Cross-tenant harness | `pnpm --filter @gastro-saas/testing test:integration`  | local Supabase running                              |
| e2e (Playwright)     | `pnpm --filter @gastro-saas/web test:e2e`              | local Supabase running; starts or reuses `pnpm dev` |

Notes:

- Integration tests exercise migrations, RLS policies and RPCs against a real database and are what CI's "Migration Validation" job runs after `supabase start`. Every ticket touching a tenant-scoped table needs a cross-tenant test (two seeded tenants, see `packages/testing`).
- e2e is local-only today: `apps/web/e2e/login.spec.ts` covers register -> logout -> login. It is not a CI gate. The Stripe payment path is verified manually against Stripe test mode (see the runbook).
- Coverage floor: `apps/web/vitest.config.mts` fails `test:coverage` below statements 74 / branches 59 / functions 80 / lines 75 (about 2 points below the measured baseline in [test-strategy.md](../testing/test-strategy.md)). It is only enforced with `--coverage`; plain `pnpm test` and CI are unaffected. Raise the thresholds when the baseline improves.
- Before pushing, also run `pnpm lint`, `pnpm typecheck`, `pnpm build` and `pnpm format:check`; CI runs all of them (plus a secret scan) and they are required status checks.

## Useful local commands

```bash
pnpm --filter @gastro-saas/database db:lint   # supabase db lint
pnpm --filter @gastro-saas/database db:stop   # free Docker resources
pnpm --filter @gastro-saas/web build:cf       # OpenNext Cloudflare build
pnpm --filter @gastro-saas/web preview:cf     # run the Worker build locally
```

New migrations go in `supabase/migrations/<YYYYMMDDHHMMSS>_<snake_case>.sql`; any new tenant-scoped table ships its `tenant_id` column and RLS policy in the same migration (see `.claude/rules/database-migrations.md`). Migrations are **not** applied to the hosted project automatically; see [deployment-strategy.md](../operations/deployment-strategy.md) and the migration-drift entry in [troubleshooting](../operations/troubleshooting.md).
