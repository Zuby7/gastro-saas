# System Context

## Actors

- **Restaurant owner / staff** (Owner, Manager, Kitchen, Service, Marketing roles) — use the admin app to configure the restaurant, manage the menu, run operations, view analytics.
- **Customer** — browses the public menu, orders, pays, rates.
- **Platform operator** (the gastro-saas team) — provisions tenants, monitors the platform, approves production changes.
- **External systems** (future) — delivery marketplaces, POS systems, accounting tools, reservation systems — via the integration layer only, never direct database access.

## High-level architecture

```
                       ┌────────────────────────────┐
                       │   Next.js app (App Router) │
                       │  - Admin UI (authenticated)│
                       │  - Public menu (SSR)       │
                       │  - API routes / server     │
                       │    actions per domain      │
                       └─────────────┬──────────────┘
                                     │
                 ┌───────────────────┼────────────────────┐
                 │                   │                     │
        ┌────────▼────────┐ ┌────────▼────────┐  ┌─────────▼────────┐
        │   Supabase       │ │  Stripe Connect  │  │  Resend / Sentry │
        │ Postgres + RLS   │ │  (payments,      │  │  / PostHog       │
        │ Auth + Storage   │ │   webhooks)      │  │  (email/errors/  │
        │                  │ │                  │  │   product usage) │
        └──────────────────┘ └──────────────────┘  └───────────────────┘
```

Deployed on Cloudflare Pages/Workers (via the `@opennextjs/cloudflare` adapter). See `docs/platform/service-register.md` for why Cloudflare was chosen over Vercel (commercial-use restriction on Vercel's free Hobby tier).

## Modular monolith, not microservices

One deployable Next.js application internally organized into domain modules (identity, tenants, authorization, restaurant profile, menu, ordering, payments, analytics, reviews, integrations, notifications, audit). Modules communicate through explicit interfaces in `packages/domain`, not direct cross-module database queries. See ADR-0001 for the full reasoning and `domain-boundaries.md` for module contracts.

## Tenant isolation strategy (summary — full detail in `docs/security/tenant-isolation.md`)

Every tenant-owned table carries an explicit `tenant_id`. Postgres Row Level Security policies enforce isolation at the database layer as a second line of defense behind application-layer authorization checks. No cross-tenant query is ever expressed without an explicit, tested boundary.

## Payment flow (summary — full detail in `docs/security/threat-model.md` and rules under `.claude/rules/payments.md`)

Server always recalculates the order total. Stripe is the only component that ever sees card data. Order state changes to "paid" only via a verified, idempotent Stripe webhook — never from a client redirect.

## Deployment environments

- **Local**: Supabase local dev stack (Docker), Next.js dev server.
- **Preview**: automatic per-PR preview deployment (Cloudflare Pages preview or equivalent).
- **Staging**: manual promotion, used for `/release-check`.
- **Production**: requires explicit human approval for both deployment and any migration (§21.4 of the source brief).
