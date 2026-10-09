# Contributing workflow

Authoritative rules: root `CLAUDE.md`. This page is the practical walk-through. Merge-policy history: [assumptions.md](../decisions/assumptions.md) (user-directed decisions).

## 1. Ticket

- Work is tracked as GitHub Issues in `Zuby7/gastro-saas`: Milestone = Epic, each epic has a parent issue, Project board "gastro-saas Roadmap". Backlog structure and numbering: [tickets/README.md](../tickets/README.md).
- **Issue titles and bodies are German** (explicit user instruction). Everything else (code, identifiers, docs, commit messages) is English. Chat with the owner is German.
- The local mirror in `docs/tickets/` is a content record; if scope changes, update the GitHub Issue and re-sync the file, not the other way around.
- Tickets labelled `risk:security`, `risk:payment`, `risk:migration` or `risk:privacy` (or anything touching payments, auth or tenant migrations) get extra scrutiny, see section 4.
- One ticket is one focused PR. No unrelated refactoring, no speculative abstractions.

## 2. Branch

Branch from current `origin/main`:

| Type    | Pattern                   |
| ------- | ------------------------- |
| Feature | `feat/<issue>-slug`       |
| Fix     | `fix/<issue>-slug`        |
| Chore   | `chore/<issue>-slug`      |
| Docs    | `docs/<slug>` (docs-only) |

Never commit directly to `main`. Commit trailer used by the Claude Code workflow: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never commit `.env*` or secrets (hook-blocked, and Gitleaks runs in CI).

## 3. Implement and check locally

Skills: `/prepare-ticket` -> `/implement-ticket` -> `/validate-ticket` -> `/ship-ticket` (see `.claude/skills/`). The `sonnet-implementer` subagent (Sonnet) implements one ticket: production code, migrations with RLS in the same migration, tests, affected docs. It never approves its own work.

Before pushing, run the deterministic checks relevant to the change (the same gates CI enforces):

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @gastro-saas/database test:integration   # when migrations/RLS/RPCs changed (needs local Supabase)
```

Definition of Done (details: [test-strategy.md](../testing/test-strategy.md)): required tests exist and pass, a cross-tenant test for any tenant-scoped change, webhook tests for payment changes, a denied-case test for permission changes, docs updated where the change affects them. Never disable or weaken a failing test or a security gate; fix the root cause or mark the ticket `BLOCKED`.

## 4. Pull request and CI

- Open a PR against `main` using `.github/pull_request_template.md` (German headings): issue reference (`Closes #<n>`), summary, acceptance-criteria checklist, migration and rollback notes, security / tenant-isolation / analytics impact, test evidence, Opus verdict.
- CI runs on every PR and on pushes to `main`. Required status checks on `main`: `Format Check`, `Lint`, `Typecheck`, `Unit Tests`, `Build`, `Secret Scan` (all `.github/workflows/ci.yml`) and `Migration Validation` (`migration-check.yml`: `supabase start`, `supabase db lint`, DB integration tests, cross-tenant harness test). The branch must be up to date with `main` (`strict`), and admins are not exempt.
- E2E (Playwright) is local-only and not a CI gate yet; the dependency scan is not implemented yet ([test-strategy.md](../testing/test-strategy.md)).
- A new required CI job must be added to branch protection in the same PR, otherwise it gates nothing.

## 5. Review: Sonnet implements, Opus validates

- Verdicts are exactly `APPROVED`, `CHANGES_REQUESTED` or `BLOCKED`. Maximum 3 repair cycles per validated unit; after that the unit is `BLOCKED` with a concise blocker report. Never weaken acceptance criteria to force a pass.
- **Cadence (current, explicit user decision of 2026-08-01):** the `opus-validator` subagent (Opus) reviews **once at the end of each epic**, against the epic's full accumulated diff, for every ticket including security-relevant ones. For risk-labelled tickets a fresh, separate `sonnet-implementer`-model invocation additionally self-checks the diff immediately at ticket completion (a weaker same-model check, not a substitute for the Opus pass).
- Opus review scope: app code, tests, migrations, DB policies, access control, payment logic, webhooks, analytics maths, API schemas, infra/CI/deploy config, auth/storage config, scripts, hooks, dependency updates, security-sensitive docs, architecture decisions. Only pure spelling fixes get a lightweight review.
- Deterministic checks always run before Opus; Opus never substitutes for them.

## 6. Merge policy

- **No PR merges until its epic's Opus batch review returned `APPROVED`.** Under the standing user authorization, once that verdict exists the PRs of that epic may be merged without asking again; without it, nothing merges, including trivial CI/docs PRs ([ship-ticket skill](../../.claude/skills/ship-ticket/SKILL.md)).
- If `main` advanced, update your branch and let CI re-run (see [troubleshooting.md](../operations/troubleshooting.md), "PR is behind main").
- Merging does not deploy: no pipeline runs `deploy:cf`. Staging/production promotion is manual, and production deploys, production migrations, domain purchases, paid signups and Stripe live activation always need explicit human approval ([deployment-strategy.md](../operations/deployment-strategy.md), `.claude/rules/deployment.md`).
- Migrations are not applied to the hosted Supabase project by merging; apply them manually before deploying code that depends on them.

## 7. Non-negotiables (from CLAUDE.md)

Tenant isolation (`tenant_id` + RLS in the same migration, tenant context from the session never from the client), payments (server recalculates totals, only the verified idempotent webhook marks an order paid, Stripe test mode only), no secrets in browser/logs/commits, server-side authorization on every mutation and sensitive read, no scraping of Lieferando/Wolt/Uber Eats, no claiming legal compliance without qualification, no fake metrics.
