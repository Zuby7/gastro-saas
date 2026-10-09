# Routes and modules

Verified against `apps/web/src/app/**/page.tsx` and `route.ts` on 2026-10-09. Mutations are mostly Server Actions (`actions.ts` next to each page), not HTTP routes. Permission keys are defined in `apps/web/src/lib/auth/permissions.ts`; "member" means a signed-in user with a tenant membership. Every `/account/*` page redirects to `/login` without a session and resolves the tenant from the membership, never from the URL.

## Public routes (no login)

| Route                                         | Purpose                                                                                  | Auth / access                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `/`                                           | Landing page                                                                             | public                                                          |
| `/login`, `/register`                         | Staff login and owner registration (creates tenant via RPC; rate-limited)                | public                                                          |
| `/invite/[token]`                             | Accept a staff invitation                                                                | invitation token (hash checked in DB)                           |
| `/agb`, `/datenschutz`                        | Platform terms and privacy policy (`/datenschutz#cookies` has the cookie table)          | public                                                          |
| `/r/[slug]`                                   | Public menu of one restaurant (`get_public_menu`), dish detail, cookie banner            | public; tenant from slug                                        |
| `/r/[slug]/cart`                              | Guest cart with server-calculated totals                                                 | cart cookie `gastro_cart_<slug>`                                |
| `/r/[slug]/checkout`                          | Online-first checkout form, creates order, redirects to Stripe Checkout                  | cart cookie; rate-limited                                       |
| `/r/[slug]/orders/[token]`                    | Order status (live polling), rating form after completion                                | order token, slug must match the order's tenant                 |
| `/r/[slug]/orders/[token]/beleg`              | Digital receipt (paid statuses only)                                                     | order token, same lookup as above                               |
| `/r/[slug]/impressum`, `/agb`, `/datenschutz` | Restaurant-owned legal pages (tenant content, edited under `/account/profile`)           | public                                                          |
| `/media/[...path]`                            | Redirects to a short-lived signed URL for a dish photo of a published, non-archived dish | public; path authorized against `media_assets` + published menu |

## Account routes (staff, signed in)

| Route                                      | Purpose                                                                                   | Permission                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/account`                                 | Overview, logout, create tenant if none, invite members                                   | membership (invite action checks `users.invite`)                        |
| `/account/profile`                         | Restaurant profile, opening hours and legal page texts                                    | `tenant.settings.write`                                                 |
| `/account/menu`                            | Categories, dishes, publish workflow                                                      | `menu.write` (publish: `menu.publish`)                                  |
| `/account/menu/dishes/[dishId]`            | Variants, option groups/extras, allergens, image upload, availability, manual sales entry | `menu.write`, `menu.availability.manage`, `analytics.manualsales.write` |
| `/account/menu/import`                     | Excel/CSV sales import (staged batches)                                                   | `analytics.manualsales.write`                                           |
| `/account/qr`                              | Generate table / pickup QR codes                                                          | membership                                                              |
| `/account/orders`                          | Live order board and kitchen workflow                                                     | `orders.read` (changes: `orders.manage`)                                |
| `/account/orders/[orderId]`                | Order detail, cancel, refunds                                                             | `orders.read`, `payments.read` / `payments.refund`                      |
| `/account/payments`                        | Stripe Connect onboarding and account status                                              | `payments.read` / `payments.connect`                                    |
| `/account/payments/refresh`, `/return`     | Stripe Account Link refresh and return landing pages                                      | `payments.connect` / `payments.read`                                    |
| `/account/analytics`, `/dishes`, `/trends` | Dashboard, top/low performers, trend and extras analytics                                 | `analytics.read`                                                        |
| `/account/reviews`                         | Review moderation queue                                                                   | `reviews.read` / `reviews.moderate`                                     |
| `/account/privacy`                         | Data export and deletion requests                                                         | `tenant.settings.write` / `tenant.data.delete`                          |
| `/account/integrations`                    | Integration accounts and mock-provider sync                                               | `integrations.manage`                                                   |

Roles map to permission sets in the database (Owner, Manager, Kitchen, Service, Marketing; custom roles possible). Grep `insert into permissions` in `supabase/migrations/` for the authoritative list.

## API routes

| Route                          | Method | Purpose                                                                                                                               | Auth                                                        |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `/api/webhooks/stripe`         | POST   | Stripe payment events (`checkout.session.completed/expired`, `payment_intent.payment_failed`); the only path that marks an order paid | Stripe signature (`STRIPE_WEBHOOK_SECRET`) + event-id dedup |
| `/api/webhooks/stripe-connect` | POST   | Stripe Connect `account.updated`; updates `payment_accounts` status                                                                   | Stripe signature (`STRIPE_CONNECT_WEBHOOK_SECRET`) + dedup  |
| `/api/qr`                      | GET    | PNG QR code for the caller's own tenant (`slug`, optional `table`, `pickup`)                                                          | session required (401 otherwise); tenant from membership    |
| `/api/account/privacy/export`  | GET    | Tenant data export                                                                                                                    | session + `tenant.settings.write`; audit-logged             |

Middleware (`apps/web/src/middleware.ts`) runs on all paths except `_next/static`, `_next/image` and `favicon.ico`.

## Module map: `apps/web/src/lib`

| Module           | Responsibility                                                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/`      | `server.ts` cookie-bound client (RLS as the user); `admin.ts` service-role client for guest/webhook paths (server only)                              |
| `tenant/`        | `getCurrentMembership()`: tenant context from the session                                                                                            |
| `auth/`          | zod schemas, `requireTenantPermission` / `hasTenantPermission`, rate limiting (+ Supabase store), client IP, role labels                             |
| `timing/`        | Response-time floor against login timing side channels                                                                                               |
| `audit/`         | Audit-event writers (login, menu admin, order events)                                                                                                |
| `invitations/`   | Invitation tokens and invitation email                                                                                                               |
| `menu/`          | Get-or-create the tenant's current draft menu version                                                                                                |
| `public-menu/`   | `getPublicMenu()`, legal page fetch, price formatting                                                                                                |
| `images/`        | Dish image header checks and re-encoding (`@cf-wasm/photon`)                                                                                         |
| `import/`        | Excel/CSV sales file parsing                                                                                                                         |
| `cart/`          | Cart token and cookie, RPC wrappers (`service.ts`), types                                                                                            |
| `orders/`        | Order service (create from cart), token/cookie, status lookup and polling, staff dashboard service/diff, receipt, labels                             |
| `payments/`      | Checkout Session creation, webhook processing, refund service, awaiting-payment constants                                                            |
| `stripe/`        | `createStripeClient()` (test-mode gate, Fetch HTTP client), webhook secret getters, Connect helpers (Express account, Account Link, status snapshot) |
| `notifications/` | Order confirmation email (Resend, logged in `email_sends`)                                                                                           |
| `analytics/`     | Dashboard, dish-performance, trend and extras services (call the analytics RPCs)                                                                     |
| `menu-view/`     | Visit cookie name/token, view and add-to-cart recording with hashed visitor id and HMAC'd IP                                                         |
| `consent/`       | Consent cookie, cookie inventory (typed, tested), cookie table and platform cookie link                                                              |
| `ratings/`       | Guest rating submission and moderation services, schemas, labels                                                                                     |
| `integrations/`  | Integration service around the mock provider, labels, types                                                                                          |

## Packages

| Package                 | Contents                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@gastro-saas/domain`   | `analytics` (performance classification, trend comparison), `audit` (secret detection), `cart` (pricing), `integrations` (provider interface, mock), `menu` (publish quality checks), `orders` (state machine), `payments`, `restaurant`, `sales-import`, `qr`. Pure TS, no I/O |
| `@gastro-saas/database` | `db:*` scripts, `scripts/run-local-seed.mjs`, `src/*.integration.test.ts` (RLS, RPCs, migrations against real Postgres)                                                                                                                                                         |
| `@gastro-saas/testing`  | Cross-tenant fixture and helpers (`seedTwoTenantFixture`, `queryAsUser`, `expectCrossTenantDenied`)                                                                                                                                                                             |
| `@gastro-saas/ui`       | Shared UI components                                                                                                                                                                                                                                                            |
| `@gastro-saas/config`   | Prettier config and tsconfig base                                                                                                                                                                                                                                               |

Drift note: the module boundaries in [domain-boundaries.md](../architecture/domain-boundaries.md) are conceptual; identity, tenants, authorization, reviews and notifications live in `apps/web/src/lib` rather than `packages/domain`.
