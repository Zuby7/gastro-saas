# Test Strategy

## Pyramid

- **Unit** (Vitest): pricing, option-selection validation, order totals, tax calculation, availability rules, state machines, permission evaluation, analytics calculations (trend comparison, low-performer thresholds), publication checks.
- **Integration** (Vitest + real/local Supabase): database constraints, RLS policies, tenant isolation, transactional order creation, payment webhook processing, refund processing, menu publication, audit logging, permission boundaries.
- **End-to-end** (Playwright): onboarding → publish; customer order journey incl. Stripe test-mode payment; kitchen operation; permission boundaries (kitchen can't see revenue, marketing can't refund, etc.); analytics correctness after a paid order and after a refund; tenant isolation between two seeded tenants.
- **Accessibility** (Playwright + axe or equivalent): menu browsing, dish detail dialog, cart, checkout, admin menu editing — automated checks plus a manual checklist for these same flows before each release.
- **Performance**: budgets for public page load, image delivery, JS payload, menu query, dashboard query — introduced once the core flow is stable, not before.

## Cross-tenant test harness

`packages/testing` (ticket #5) provides a reusable fixture for the tenant-isolation cross-tenant tests required above and in `docs/security/tenant-isolation.md`, so individual tickets don't have to re-derive it from scratch:

- `seedTwoTenantFixture(admin)` seeds two tenants, each with an Owner membership (and optional extra members), directly against a real Postgres connection (bypassing RLS, like a `service_role`/migration/seed script would) — mirrors two tenants with similar shapes and returns a `cleanup()` to remove everything it created.
- `queryAsUser(client, userId, sql, params)` runs a query as a simulated authenticated Supabase session for `userId` (`set role authenticated` + `set_config('request.jwt.claims', ...)`), exercising real RLS without depending on Epic 3's auth implementation.
- `expectCrossTenantDenied({ client, actorUserId, sql, params })` asserts that a query attempting to read/write another tenant's row(s) is denied by RLS — accepting either denial shape (zero rows returned/affected, or a thrown row-level-security/permission-denied error) and failing the test if the query instead succeeds with foreign-tenant rows.

These generalize the ad-hoc pattern `packages/database/src/tenants.integration.test.ts` (ticket #4) wrote inline. See `packages/testing/src/tenant-fixture.ts` for full API docs and `packages/testing/src/tenant-fixture.integration.test.ts` for a worked example against the `brands`/`locations` RLS model. Explicit non-goal: this harness has no UI-test coverage — it only exercises Postgres RLS directly via `pg`.

## Payment-specific tests

Stripe test mode + mocked webhook signatures: success, failure, cancellation, duplicate webhook, delayed/out-of-order webhook, invalid signature, amount mismatch, partial refund, full refund.

## Analytics correctness tests

Refunds, partial refunds, cancelled orders, timezone boundaries, DST transitions, incomplete current periods, archived/renamed products, duplicated webhook events, currency handling, tenant isolation of aggregates.

## Definition of Done test gate (see also root `CLAUDE.md`)

A ticket is not Done until: relevant unit/integration/E2E tests exist and pass, lint + typecheck + build pass, and — for tenant-scoped changes — a cross-tenant test exists and passes. No ticket disables a failing test to turn CI green; if a test is wrong, fix the test with justification in the PR, don't silence it.

## CI gate order (deterministic before Opus)

format → lint → typecheck → unit → integration → build → migration validation → secret scan → dependency/security scan → E2E smoke (where environment permits). Opus validation happens only after this passes; Opus never substitutes for these tools.

Implemented in `.github/workflows/ci.yml`: format, lint, typecheck, unit, build, secret scan. Integration tests and migration validation (including the cross-tenant RLS integration test) run in the separate `.github/workflows/migration-check.yml` job, "Migration Validation". Dependency/security scan and E2E smoke are follow-up tickets once Playwright and a dependency-scan tool are introduced.

**E2E-in-CI status (reaffirmed explicitly during ticket #7's fix cycle 1, 2026-08-01)**: Playwright (`apps/web/e2e/`, `apps/web/playwright.config.ts`) is introduced but deliberately still local-only, not a required CI status check. Reason: it needs both a real local Supabase stack (`supabase start`) and a running Next.js server in the same job, and no current CI job provisions both together (`migration-check.yml` only starts Supabase; `ci.yml` never starts a dev/prod server). This is not a silent gap -- both E2E specs were run locally against the real stack while validating ticket #7's fix cycle 1 and pass. Follow-up, not done here: add a CI job that runs `supabase start` + `next build && next start` + `playwright test` together, then promote it to a required "E2E Smoke" status check.

### Required status checks (branch protection on `main`)

As of 2026-08-01 (backfilled per-ticket Opus review of ticket #3), `main`'s branch protection requires all of the following status checks to pass before merge, with `strict: true` (branch must be up to date) and `enforce_admins: true` (no bypass, including for repo admins):

- `Format Check`
- `Lint`
- `Typecheck`
- `Unit Tests`
- `Build`
- `Secret Scan`
- `Migration Validation` (runs `supabase start`, `supabase db lint`, and the tenant-isolation integration test — added because a broken migration or a failing cross-tenant RLS test must block merge, not just warn)

Any new required CI job must be added to branch protection via the GitHub API (`gh api -X PUT repos/<owner>/<repo>/branches/main/protection`) in the same PR that introduces it — a job that isn't required doesn't actually gate anything.
