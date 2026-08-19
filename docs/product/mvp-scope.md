# MVP Scope

## Definition of MVP success (acceptance scenario)

The MVP is done when this full journey works end-to-end in Stripe **test mode**:

1. **Onboarding**: owner registers → tenant created → restaurant profile, opening hours, branding configured → categories and dishes (with images, sizes, extras, allergens/additives) created → publication checker shows blockers/warnings → owner resolves blockers → menu published. The registration/login/atomic-tenant-onboarding step is implemented in ticket #7 (`docs/tickets/07-epic3-registrierung-login-und-tenant-onboarding.md`): Supabase Auth email/password registration and login (`apps/web/src/app/register`, `apps/web/src/app/login`), the atomic `create_tenant_with_owner` onboarding RPC (`supabase/migrations/20260801060000_auth_onboarding_rpc_and_rate_limiting.sql`), and auth rate limiting (`auth_rate_limit_attempts`, same migration).
2. **Customer order**: public menu loads → customer browses categories → opens a dish → selects a required variant → selects extras → removes an allowed ingredient → adds to cart → server recalculates and verifies price → customer chooses pickup → pays successfully in Stripe test mode → signed webhook confirms payment → order appears in the admin dashboard → customer gets confirmation + order status.
3. **Restaurant operation**: staff accepts the order → kitchen role sees prep details, changes status to preparing → ready → an unauthorized role cannot see revenue/refunds → a dish can be marked sold out and the public menu reflects it immediately.
4. **Analytics**: the paid order affects revenue/quantity/extra-revenue rankings; a refund correctly reduces net sales; data is correctly scoped to tenant and timezone.
5. **Ratings**: a customer with a completed, verified order can submit a rating; without a valid order token, they cannot.
6. **Tenant isolation**: two test tenants with similar data — neither can read or modify the other's menu, orders, analytics, users, payment config, images, ratings, or settings.

## In scope for MVP

- Single-location tenants (data model is location-ready, UI is not multi-location yet).
- Pickup and table ordering. Delivery is a feature-flagged placeholder, not implemented.
- Guest checkout only (no customer accounts yet).
- Stripe Connect in test mode; production activation requires explicit human approval later.
- Deterministic, rule-based menu quality/compliance checks. No AI dependency anywhere in the MVP.
- Custom roles with fine-grained permissions (owner/manager/kitchen/service/marketing templates + custom).
- Core sales analytics computed from the platform's own order data (not from a third-party analytics tool).
- Verified ratings tied to completed orders.
- A provider-neutral integration interface with a mock provider — no real Lieferando/Wolt/Uber Eats/POS connection.

## Explicitly deferred (see `non-goals.md` for the full list)

- Multi-location UI, restaurant groups.
- Delivery fulfillment.
- Customer accounts / login.
- Real external marketplace/POS integrations.
- AI-assisted menu import, translation, description writing, review summarization.
- Menu rollback to a previous published version (data model allows it; UI/flow ships later).
- Production payment activation, real domain, production deployment.

## Roadmap epics

See `docs/tickets/` for the ticket-level breakdown. Epics, in build order:

1. Repository & engineering foundation
2. Architecture & data foundation (tenant model, RLS, audit)
3. Authentication & authorization (roles, permissions, invitations)
4. Restaurant profile & menu administration (draft/publish, quality checks)
5. Public menu (mobile-first, accessible)
6. Cart & ordering (server-side pricing, state machine)
7. Payments (Stripe Connect, webhooks, refunds)
8. Order operations (kitchen workflow, sold-out control)
9. Analytics (topsellers, low performers, trends, extras, funnel) -- ticket #30 (revenue/order dashboard) and ticket #31 (topseller/low-performer analysis, ranked by quantity and revenue with a configurable minimum-data threshold before any "low performer" flag; see `docs/data/domain-model.md` "Analytics" and `packages/domain/src/analytics/dish-performance.ts`) are implemented; trends/extras/funnel analysis (ticket #32) remain open.
10. Ratings & quality (verified ratings, compliance-oriented checks)
11. Operations & hardening (monitoring, backups, privacy, readiness)
12. Integration foundation (provider-neutral interface, mock provider)
