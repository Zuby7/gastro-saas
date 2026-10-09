# Architecture overview

A map of how the running system fits together. Decisions and rules live elsewhere and are linked, not repeated: [ADR-0001](../architecture/adr/0001-stack-and-modular-monolith.md) (stack), [ADR-0002](../architecture/adr/0002-stripe-connect-account-model.md) (Stripe Connect), [domain-boundaries.md](../architecture/domain-boundaries.md) (modules), [tenant-isolation.md](../security/tenant-isolation.md), [domain-model.md](../data/domain-model.md), [cookie-inventory.md](../legal/cookie-inventory.md).

Shape: one Next.js app (modular monolith) talking to Supabase (Postgres + Auth + Storage) and Stripe, deployed as a Cloudflare Worker. Pure business logic is in `packages/domain`; everything that touches Supabase or Stripe is in `apps/web/src/lib/*` and the route/server-action layer in `apps/web/src/app`. See [routes-and-modules.md](routes-and-modules.md) for the file-level map.

## Customer request flow (public menu to receipt)

1. **Public menu** `/r/<slug>`: the tenant is resolved from the slug server-side. `getPublicMenu()` calls the `get_public_menu` RPC (published, non-archived data only). Dish photos are served through `/media/<path>`, which signs private Storage URLs only for assets of published dishes. If the visitor opted in to statistics, menu and dish views are recorded (see Analytics).
2. **Cart** `/r/<slug>/cart`: a guest cart is identified by an opaque random token in the httpOnly cookie `gastro_cart_<slug>`; only its SHA-256 hash reaches the database. Cart RPCs (`add_cart_item`, `update_cart_item_quantity`, `remove_cart_item`, `get_cart_view`) store line identity only and **recalculate prices and availability from live menu rows on every call**. The client never supplies a price or total.
3. **Checkout** `/r/<slug>/checkout`: `checkoutAction` validates input (zod), rate-limits (10 attempts/hour per IP and per cart), checks the tenant can take card payments (`isTenantChargeReady`), then calls `create_order_from_cart`, which locks the cart, re-runs the same server-side pricing and creates an `awaiting_payment` order with immutable item snapshots. It writes the order-access cookie `gastro_order_<slug>` (token hash in DB) and an audit event.
4. **Stripe Checkout**: `createCheckoutSessionForOrder` recalculates from the stored order, creates a hosted Stripe Checkout Session (`mode: "payment"`, destination charge to the tenant's connected account, no application fee) with idempotency key `checkout-session:<orderId>`, `expires_at` aligned with the 30-minute awaiting-payment timeout, and stores a `payments` row (`pending`). The guest is redirected to Stripe. No card data ever touches this app.
5. **Webhook** `POST /api/webhooks/stripe`: verifies the signature on the raw body, deduplicates by Stripe event id via `claim_payment_webhook_event()`, then `handleStripePaymentWebhookEvent` processes `checkout.session.completed`, `checkout.session.expired` and `payment_intent.payment_failed`. On completed it checks tenant and **amount against the server-calculated order total**, then calls `mark_order_received_and_paid` (one transaction: order `awaiting_payment` -> `received` and payment -> `paid`; a later webhook for an order whose status already moved on is declined gracefully). The order confirmation email is sent afterwards by the app and a failure there never undoes the payment. This is the only code path that marks an order paid. A mismatch, tenant mismatch or payment after cancellation sets `payments.status = flagged_for_review`, writes an audit event, and still returns 2xx (retrying cannot fix it). Unexpected errors return 5xx so Stripe retries; `processed_at` stays null so the event stays reclaimable.
6. **Order status** `/r/<slug>/orders/<token>`: Stripe redirects here with `?checkout=success|cancelled`, which is **never** proof of payment. The page reads status through `get_order_status_by_token` (token hash compared per row, slug must match) and polls with a server action until a terminal state. Status shows "Bestellung eingegangen" once the webhook has been processed.
7. **Receipt** `/r/<slug>/orders/<token>/beleg`: same token-read path, shown only for paid statuses; unknown or cross-tenant tokens render the generic not-found page.

Orders that stay `awaiting_payment` are cancelled by `sweep_stale_awaiting_payment_orders()` (pg_cron every 5 minutes, default 30 minutes).

## Payments state machine

Order status (canonical in `packages/domain/src/orders/state-machine.ts`, mirrored in SQL by `is_valid_order_status_transition()` and a trigger):

```
awaiting_payment -> received -> accepted -> preparing -> ready -> completed
        \               \            \            \
         +---------------+------------+------------+--> cancelled   (not from ready/completed)
```

- `orders.status` is a denormalized current value, written only through the append-only `order_status_events` trail (`sync_order_status_from_event()`). Direct updates are rejected for app roles.
- `awaiting_payment -> received` happens only in the verified webhook. Staff advance `received -> ... -> completed` from `/account/orders` (needs `orders.manage`; cancelling needs `orders.cancel`).
- `payments.status`: `pending`, `paid`, `failed`, `cancelled`, `flagged_for_review`. `refunds.status`: `pending`, `succeeded`, `failed`, `unconfirmed`.
- Refunds (`payments.refund` permission): the row and its amount are reserved in the DB first, then `stripe.refunds.create` runs with idempotency key `refund:<refund id>`, then `finalize_refund()` records the outcome. An ambiguous Stripe failure leaves the row `unconfirmed` and blocks further refunds until a human reconciles it ([refund-reconciliation.md](../operations/refund-reconciliation.md)). Refunds can never exceed the paid amount (enforced in the DB).
- Connect onboarding: `payment_accounts.status` is `pending` / `restricted` / `enabled`, driven by Stripe's own account data: the `account.updated` webhook (`POST /api/webhooks/stripe-connect`, applied via `apply_connect_account_snapshot()`) and a server-side re-fetch on the onboarding return page, never by redirect parameters. Rules in `.claude/rules/payments.md`.
- Test mode only: `createStripeClient()` refuses any key not starting with `sk_test_` / `rk_test_`. Procedure: [runbook-stripe-test-mode.md](../operations/runbook-stripe-test-mode.md).

## Tenant isolation model

Three layers, details in [tenant-isolation.md](../security/tenant-isolation.md):

- **Layer 1, authenticated staff**: the tenant always comes from the session's own membership (`getCurrentMembership()` in `lib/tenant/current-membership.ts`), never from client input. Pages and actions additionally check a permission key (`lib/auth/permissions.ts`: `requireTenantPermission` calls the `require_tenant_permission` RPC; pages use `hasTenantPermission` / `has_tenant_permission`). UI hiding is never authorization.
- **Layer 0, guests (no membership)**: the tenant is resolved from the URL slug server-side; writes go through the service-role admin client (`lib/supabase/admin.ts`) calling RPCs that are granted to `service_role` only (no `anon` grants on tenant tables). Guest reads use an unguessable per-purpose token (cart token, order token, rating via order token) checked against the specific row.
- **Layer 2, RLS**: every tenant-scoped table has `tenant_id` and an RLS policy in the same migration. This is the safety net, never the only layer.
- Tests: every ticket touching a tenant-scoped table adds a cross-tenant test using `packages/testing` (`seedTwoTenantFixture`, `queryAsUser`, `expectCrossTenantDenied`), run against real Postgres.

## RLS / RPC pattern

- Reads of tenant data by staff go through the cookie-bound server client (`lib/supabase/server.ts`), so RLS applies as the signed-in user.
- Anything needing atomicity, privilege or guest access is a Postgres function (RPC) in `supabase/migrations/`. Conventions: `security definer` functions set `search_path = ''` and schema-qualify everything; permission-gated RPCs call `require_tenant_permission` themselves; guest/webhook RPCs are granted to `service_role` only; sensitive tables are INSERT-only or column-locked for app roles (audit log, order items, order status events, refunds finalization).
- Analytics (`get_analytics_dashboard_summary`, `get_dish_performance_stats`, trend/extras RPCs) enforce `analytics.read` inside the function and filter by tenant first.
- Scheduled jobs use pg_cron inside Postgres (awaiting-payment sweep; purge of hashed-IP rows). No queue system.
- Migrations: `supabase/migrations/<timestamp>_<name>.sql`, applied by `supabase start` locally and validated in CI; **not** auto-applied to the hosted project ([troubleshooting](../operations/troubleshooting.md), migration drift). Rules: `.claude/rules/database-migrations.md`.

## Cloudflare Workers constraints

The app runs on workerd via `@opennextjs/cloudflare` (`apps/web/wrangler.jsonc`, `nodejs_compat`, compatibility date `2024-09-23`). Consequences already handled in code, which new code must respect:

- **Stripe uses the Fetch HTTP client**: the SDK's default client uses Node `https`, unsupported in workerd. `createStripeClient()` passes `httpClient: Stripe.createFetchHttpClient()`. Do not construct `new Stripe(...)` elsewhere, and do not add libraries that need Node `https`/`http` sockets or the filesystem.
- **No `sharp`**: dish image re-encoding (`lib/images/re-encode-dish-image.ts`) uses `@cf-wasm/photon` (WASM). `exceljs` (sales import) runs on `nodejs_compat` with in-memory buffers only; it has had no dedicated Workers smoke test (see [assumptions.md](../decisions/assumptions.md)).
- **`next@16.2.12` is patched**: `patches/next@16.2.12.patch` (registered in `pnpm-workspace.yaml` `patchedDependencies`) makes `getMiddlewareManifest()` use `loadManifest()` instead of a raw `require()` that workerd rejects (upstream opennextjs-cloudflare#1380). Do not bump `next` or `@opennextjs/cloudflare` without re-checking this ([deployment-strategy.md](../operations/deployment-strategy.md)).
- **Env handling**: `NEXT_PUBLIC_*` values are inlined at build time (`build:cf`); server secrets are Worker secrets (`wrangler secret put`); `NEXT_PUBLIC_APP_URL` is a plain `vars` entry in `wrangler.jsonc`.
- Deploys never happen automatically: no CI job runs `deploy:cf`; production deploys need explicit approval.

## Forms (input preserved on error)

React 19 automatically resets the uncontrolled fields of a `<form action={formAction}>` once the action finished -- even when it returned a validation error, so users lost everything they typed (e.g. guest checkout without the AGB checkbox). All forms with user input therefore use `usePreservedFormAction` (`apps/web/src/lib/forms/use-preserved-form-action.ts`) and spread the returned `formProps` (`<form {...formProps}>`: both `action` and `onSubmit`) onto the form. The hook prevents the native submit, builds the `FormData` (including the submitter), runs the unchanged server action through `useActionState` inside a transition, and calls `form.reset()` only on success (default: no `error` and no non-empty `fieldErrors` in the state; `resetOnSuccess: false` for edit forms whose values are the saved ones). Chosen over feeding values back as `defaultValue` because it works for every field type (checkbox, radio, select, file, number) without per-field wiring, and the server action signatures stay the same. Forms that contain only hidden fields/buttons (archive, move, delete, publish, remove-from-cart, direct add-to-cart) keep `action={formAction}` -- there is nothing to lose. `action` must stay next to `onSubmit`: with JS, `onSubmit` calls `preventDefault()` so React skips the action (and its auto-reset); before hydration or without JS the browser POSTs to the server action instead of doing a bare GET that would put typed values (passwords, names, phone numbers) into the URL, history, logs and Referer. Login/register additionally clear only the password field after an error (`clearOnError`). Error messages keep `role="alert"`.

## Cookies and consent

The cookie inventory is [cookie-inventory.md](../legal/cookie-inventory.md) (German); the typed source is `apps/web/src/lib/consent/inventory.ts`, rendered by both the consent dialog and the privacy page, and `inventory.test.ts` fails if code sets a `gastro_*` cookie missing from it.

| Cookie                  | Purpose                                                          | Category   | Consent    |
| ----------------------- | ---------------------------------------------------------------- | ---------- | ---------- |
| `gastro_cookie_consent` | stores the decision `{version, timestamp, statistics}`, 6 months | necessary  | no         |
| `gastro_cart_<slug>`    | guest cart token (httpOnly, 14 days)                             | necessary  | no         |
| `gastro_order_<slug>`   | guest order access token (httpOnly, 3 days)                      | necessary  | no         |
| `sb-*`                  | Supabase auth session (httpOnly, via `@supabase/ssr`)            | necessary  | no         |
| `gastro_view_<slug>`    | anonymous visit id for analytics (httpOnly, 24 h)                | statistics | **opt-in** |

`middleware.ts` runs on every request (except static assets): it refreshes the Supabase session (`getUser()`), mints `gastro_view_<slug>` only on `/r/<slug>` and only with a valid, current `statistics: true` consent, and deletes any `gastro_view_*` cookie when statistics consent is absent or withdrawn. A new cookie or script requires inventory + banner/dialog + privacy-text changes in the same PR; bump `CONSENT_VERSION` (`lib/consent/cookie.ts`) for material changes.

## Analytics

- **Revenue analytics** are computed live in SQL from the tenant's own `orders` / `payments` / `refunds` (net of refunds, timezone-aware), surfaced at `/account/analytics`, `/account/analytics/dishes` and `/account/analytics/trends`. Ranking and trend maths are pure code in `packages/domain/src/analytics`. Empty states are honest (no fabricated zeros).
- **Engagement analytics** (menu views, dish views, add-to-cart): `lib/menu-view/service.ts` calls the `record_menu_view` / `record_dish_view(s)` / `record_add_to_cart_event` RPCs, deduplicated per visitor per day. Only a SHA-256 hash of the cookie token and an **HMAC-SHA256 of the IP keyed by `IP_HASH_SECRET`** are stored (`menu_view_attempts`, `dish_engagement_attempts`); without the secret in production nothing is recorded. Purge functions delete rows after 35 days; the daily pg_cron schedule exists in migration `20260906170000` but must be run manually on the hosted project ([deployment-strategy.md](../operations/deployment-strategy.md)).
- **Manual sales** (`manual_sales_entries`, Excel/CSV import) are stored and shown separately as estimates; they never influence real-order figures or top/low-performer ranking.
- Not implemented: removed-ingredient analysis (no per-order data model for it).
