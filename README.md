# gastro-saas

Multi-tenant SaaS platform for independent gastronomy businesses (cafés, pizzerias, restaurants, snack bars, bakeries, takeaways): manage the menu, accept orders (pickup or table), get paid securely via Stripe Connect, and understand what customers actually buy.

> Internal working name. No public brand name has been chosen yet.

## Status (2026-10-09)

Epics 1-12 and large parts of the compliance, deployment and quality epics are implemented and deployed in **Stripe test mode only** to a Cloudflare Worker (`https://gastro-saas-web.gastro-saas-web.workers.dev`). Implemented today:

- Auth, tenants, invitations, roles and permissions (RBAC), audit log.
- Restaurant profile and menu admin (draft/publish, variants, extras, allergens, images, QR codes).
- Public menu per restaurant (`/r/<slug>`), guest cart with server-side pricing, online-first checkout, Stripe Checkout, webhook-driven payment state, order status page and digital receipt.
- Staff order dashboard, kitchen workflow, sold-out control, refunds.
- Analytics (dashboard, top/low performers, trends, extras, manual sales and Excel/CSV import), ratings with moderation, privacy export/deletion requests, legal pages and cookie consent, mock integration provider.

Production Stripe activation, a custom domain, Sentry (#89) and a CD pipeline for the Worker are **not** done; see `docs/operations/deployment-strategy.md` for the open follow-ups and `docs/decisions/assumptions.md` for what was decided without asking.

## Stack (see ADR-0001 for reasoning)

TypeScript (strict), Next.js 16 (App Router) + React 19, Tailwind 4, PostgreSQL via Supabase (auth, storage, RLS, RPC, pg_cron), Stripe Connect (Express accounts, destination charges, test mode), Resend (transactional email), Cloudflare Workers via `@opennextjs/cloudflare`, pnpm workspace, Vitest + Playwright.

## Repository layout

| Path                | Contents                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `apps/web`          | The Next.js app: routes (`src/app`), server-side modules (`src/lib`), middleware, e2e specs  |
| `packages/domain`   | Pure TypeScript domain logic (cart pricing, order state machine, analytics maths, QR, audit) |
| `packages/database` | Local Supabase tooling (`db:*` scripts, seed runner) and DB/RLS integration tests            |
| `packages/testing`  | Reusable cross-tenant test harness (`seedTwoTenantFixture`, `expectCrossTenantDenied`)       |
| `packages/ui`       | Shared design-token based components                                                         |
| `packages/config`   | Shared Prettier / tsconfig base                                                              |
| `supabase`          | `config.toml`, `migrations/` (schema + RLS + RPCs), `seed.sql` (demo tenant), `seed-assets/` |
| `patches`           | `pnpm patch` for `next@16.2.12` (Cloudflare middleware-manifest fix)                         |
| `docs`              | All product, architecture, security, operations and decision docs (index: `docs/README.md`)  |
| `.github/workflows` | `ci.yml` (format, lint, typecheck, unit, build, secret scan), `migration-check.yml`          |
| `.claude`           | Claude Code operating model: subagents, rules, skills, hooks                                 |

## Quick start

Prerequisites: Node.js >= 20, Docker (required for the local Supabase stack), Git.

```bash
pnpm install
cp .env.example apps/web/.env.local     # local defaults work as-is, see docs/development/getting-started.md
pnpm --filter @gastro-saas/database db:start    # supabase start (needs Docker)
pnpm --filter @gastro-saas/database db:reset    # apply migrations + demo seed
pnpm dev                                # http://localhost:3000
```

Windows notes:

- `pnpm` may not be on `PATH`. Use `npx pnpm <command>` (or `corepack enable` if it works on your machine; on the original dev machine Corepack failed with EPERM, so pnpm was installed with `npm install -g pnpm` and `%APPDATA%\npm` added to `PATH`).
- Git prints `LF will be replaced by CRLF` warnings on Windows. They are harmless, but Prettier (`format:check`) runs on Linux in CI, so do not commit files with CRLF line endings; see `docs/operations/troubleshooting.md`.
- Docker Desktop must be running before `db:start`.

## Standard commands

| Command                                                 | What it does                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev`                                              | Next.js dev server for `apps/web` on port 3000                        |
| `pnpm lint` / `pnpm typecheck`                          | ESLint / `tsc --noEmit` in every package that defines the script      |
| `pnpm test`                                             | Vitest unit tests in all packages (no database needed)                |
| `pnpm --filter @gastro-saas/web test:coverage`          | Unit tests with coverage and the coverage floor (see test strategy)   |
| `pnpm --filter @gastro-saas/web test:e2e`               | Playwright e2e (local only; needs local Supabase)                     |
| `pnpm --filter @gastro-saas/database test:integration`  | DB/RLS integration tests against local Supabase                       |
| `pnpm --filter @gastro-saas/testing test:integration`   | Cross-tenant harness self-test against local Supabase                 |
| `pnpm build`                                            | Production Next.js build                                              |
| `pnpm format` / `pnpm format:check`                     | Prettier write / check (CI runs the check)                            |
| `pnpm --filter @gastro-saas/web build:cf` / `deploy:cf` | OpenNext Cloudflare build / deploy (production deploy needs approval) |

## Documentation

Start with `docs/README.md` (index of everything). Most useful entry points:

- Developer setup: `docs/development/getting-started.md`
- How the system fits together: `docs/development/architecture-overview.md`
- Routes and modules: `docs/development/routes-and-modules.md`
- Contribution flow: `docs/development/contributing-workflow.md`
- Stripe test mode: `docs/operations/runbook-stripe-test-mode.md`; problems we hit: `docs/operations/troubleshooting.md`
- Non-negotiable rules: `CLAUDE.md`, `docs/security/tenant-isolation.md`, `.claude/rules/`

## License

Not yet decided; proprietary by default until the owner says otherwise.
