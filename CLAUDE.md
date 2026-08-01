# gastro-saas — CLAUDE.md

Multi-tenant gastronomy SaaS (working name `gastro-saas`). Full product spec lives in `docs/`; do not duplicate it here. This file holds only invariant rules.

## Project structure

- `apps/web` — Next.js app (App Router). `packages/domain`, `packages/database`, `packages/ui`, `packages/config`, `packages/testing` — see `docs/architecture/domain-boundaries.md`. Collapse to a single app if the monorepo overhead isn't paying for itself; record that as a new ADR if it happens.
- `docs/` — single source of truth for product, architecture, security, data model, operations, decisions. Update the authoritative doc when a decision changes; don't create a second conflicting doc.
- `docs/tickets/` — local mirror of the GitHub Issues backlog.

## Standard commands (once the app is scaffolded)

`pnpm install` · `pnpm dev` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:e2e` · `pnpm build`

Note: `pnpm` may not be on PATH in every shell on this machine — see `docs/decisions/assumptions.md`.

## Mandatory Sonnet → deterministic checks → Opus workflow

Every ticket: `sonnet-implementer` (model: sonnet) implements → deterministic checks run (format, lint, typecheck, unit, integration, build, migration validation, secret scan) → `opus-validator` (model: opus, i.e. Opus 5 — the current frontier Opus, not a pinned older version) reviews. See `.claude/agents/` and skills `/prepare-ticket` → `/implement-ticket` → `/validate-ticket` → `/ship-ticket`.

**Opus validation cadence** (explicit user decision, 2026-08-01, revised same day after Epic 1's batch review — reverts the batching default below back to per-ticket-always): `opus-validator` reviews **every ticket individually, immediately after `/implement-ticket`**, regardless of risk label. The end-of-epic batch mode (previously the default for non-risk-labelled tickets) is no longer used going forward — kept in `/validate-ticket` only as a documented fallback mode, not the active one. Reasoning: Epic 1's batch review and ticket #4's per-ticket review both surfaced real, non-trivial findings, and the user decided the per-ticket signal is worth the extra Opus cost.

Verdict is exactly one of `APPROVED` / `CHANGES_REQUESTED` / `BLOCKED`, at whichever granularity applied (ticket or epic). Max 3 repair cycles per validated unit; after that, mark it `BLOCKED` with a concise blocker report — never weaken acceptance criteria, disable tests, or remove security checks to force a pass.

Opus review scope (ticket- or epic-level, per the cadence above) covers: app code, tests, migrations, DB policies, access control, payment logic, webhooks, analytics calculations, API schemas, infra/CI/deploy config, auth config, storage config, scripts, hooks, dependency/package updates, security-sensitive docs, architecture decisions. Lightweight review only for pure spelling fixes — every epic still gets a recorded verdict before its milestone is closed.

## Tenant isolation (non-negotiable)

Every tenant-scoped table has an explicit `tenant_id` + a Postgres RLS policy shipped in the same migration. Tenant context always comes from the authenticated session's membership, never from a client-supplied value. Any ticket touching a tenant-scoped table needs a cross-tenant test (two seeded tenants, prove no cross-read/write). Full detail: `docs/security/tenant-isolation.md`.

## Payments (non-negotiable)

Never store card data. Never trust a client-calculated total or a client redirect as proof of payment — the server always recalculates and only a verified, idempotent Stripe webhook moves an order to "paid". Stripe test mode only until the user explicitly approves production activation. Full detail: `.claude/rules/payments.md`.

## Testing requirements

No ticket is Done without the tests required by `docs/testing/test-strategy.md` passing. Never disable a failing test or lower a security/quality gate to make CI green — fix the root cause or mark the ticket `BLOCKED`.

## Security rules

No secrets in the browser, in logs, or in commits (`.env*` is hook-blocked). Server-side authorization on every mutation and sensitive read — UI hiding is never authorization. See `.claude/rules/security.md` and `docs/security/threat-model.md`.

## Branch & ticket workflow

- One ticket = one focused PR. Branches: `feat/<issue>-slug`, `fix/<issue>-slug`, `chore/<issue>-slug`.
- Tickets live as GitHub Issues (titles/descriptions in German per explicit user instruction) mirrored under `docs/tickets/`.
- PR description references the issue number, includes acceptance-criteria checklist, test evidence, and the Opus verdict.

## Token efficiency

- Main session model: Sonnet, unless a task explicitly needs Opus validation.
- Read only what's relevant to the current ticket — the ticket, relevant ADRs, relevant files, the diff. Don't read the whole repo. Don't re-read unchanged files.
- Keep subagent output concise: conclusion, evidence, changed files, failed checks, required actions — no long narratives, no re-pasted ticket text, no full log dumps (store those as artifacts instead).

## Forbidden

- Sonnet approving its own implementation. Skipping Opus validation to save tokens. Disabling failing tests without justification. Trusting client-calculated payment totals. Exposing payment secrets or the Supabase service-role key to the browser. Cross-tenant queries without enforcement. UI-only authorization. Scraping Lieferando/Wolt/Uber Eats or any protected platform. Claiming legal compliance without qualification. Fake/inflated metrics. Automatic production deploys, domain purchases, or paid service signups without explicit approval.

## Language

Code, identifiers, docs, commits: English. GitHub issue titles/bodies: German (explicit user instruction, see `docs/decisions/assumptions.md`). Chat with the user: German.
