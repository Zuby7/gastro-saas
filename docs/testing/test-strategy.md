# Test Strategy

## Pyramid

- **Unit** (Vitest): pricing, option-selection validation, order totals, tax calculation, availability rules, state machines, permission evaluation, analytics calculations (trend comparison, low-performer thresholds), publication checks.
- **Integration** (Vitest + real/local Supabase): database constraints, RLS policies, tenant isolation, transactional order creation, payment webhook processing, refund processing, menu publication, audit logging, permission boundaries.
- **End-to-end** (Playwright): onboarding → publish; customer order journey incl. Stripe test-mode payment; kitchen operation; permission boundaries (kitchen can't see revenue, marketing can't refund, etc.); analytics correctness after a paid order and after a refund; tenant isolation between two seeded tenants.
- **Accessibility** (Playwright + axe or equivalent): menu browsing, dish detail dialog, cart, checkout, admin menu editing — automated checks plus a manual checklist for these same flows before each release.
- **Performance**: budgets for public page load, image delivery, JS payload, menu query, dashboard query — introduced once the core flow is stable, not before.

## Payment-specific tests

Stripe test mode + mocked webhook signatures: success, failure, cancellation, duplicate webhook, delayed/out-of-order webhook, invalid signature, amount mismatch, partial refund, full refund.

## Analytics correctness tests

Refunds, partial refunds, cancelled orders, timezone boundaries, DST transitions, incomplete current periods, archived/renamed products, duplicated webhook events, currency handling, tenant isolation of aggregates.

## Definition of Done test gate (see also root `CLAUDE.md`)

A ticket is not Done until: relevant unit/integration/E2E tests exist and pass, lint + typecheck + build pass, and — for tenant-scoped changes — a cross-tenant test exists and passes. No ticket disables a failing test to turn CI green; if a test is wrong, fix the test with justification in the PR, don't silence it.

## CI gate order (deterministic before Opus)

format → lint → typecheck → unit → integration → build → migration validation → secret scan → dependency/security scan → E2E smoke (where environment permits). Opus validation happens only after this passes; Opus never substitutes for these tools.

Implemented in `.github/workflows/ci.yml`: format, lint, typecheck, unit, build, secret scan. Integration tests and migration validation (including the cross-tenant RLS integration test) run in the separate `.github/workflows/migration-check.yml` job, "Migration Validation". Dependency/security scan and E2E smoke are follow-up tickets once Playwright and a dependency-scan tool are introduced.

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
