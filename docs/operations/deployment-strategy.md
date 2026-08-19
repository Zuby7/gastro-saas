# Deployment Strategy

## Environments

| Environment | Trigger                           | Approval                                                                                              |
| ----------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Local       | `pnpm dev`                        | none                                                                                                  |
| Preview     | every PR                          | automatic                                                                                             |
| Staging     | manual promotion from a merged PR | automatic, run `/release-check` first                                                                 |
| Production  | explicit request                  | **always requires explicit human approval** — both the deploy itself and any migration run against it |

## Hosting

Cloudflare Pages/Workers via `@opennextjs/cloudflare` (see ADR-0001, `docs/platform/service-register.md`). Free `*.pages.dev` subdomain until a real domain is purchased (a deliberate later step, not part of this foundation pass).

## Database migrations

- Every schema change ships as a migration file + its RLS policy in the same migration.
- Migrations run automatically against local/preview/staging.
- Migrations against production require explicit approval and a documented rollback note in the PR.

### Local development (Supabase CLI)

- The Supabase CLI is a dev dependency of `packages/database` (npm package `supabase`, installed via `pnpm install` -- no global/admin install needed, matching how `pnpm`/`gh` were installed on the dev machine per `docs/decisions/assumptions.md`), invoked as `pnpm --filter @gastro-saas/database exec supabase <command>` or via the package's `db:*` scripts (`db:start`, `db:stop`, `db:reset`, `db:seed`, `db:lint` -- `db:reset`/`db:seed` wrap the local demo-seed opt-in guard, see `docs/decisions/assumptions.md`'s "Local dev demo seed data" section).
- `supabase start` runs the full local stack (Postgres, Auth, Storage, Studio, etc.) via Docker and applies every migration under `supabase/migrations/` in filename order. `supabase stop` frees the Docker resources afterwards.
- Migration file naming convention: `supabase/migrations/<YYYYMMDDHHMMSS>_<snake_case_name>.sql` (Supabase CLI default ordering).
- `supabase/migrations/20260801040000_tenant_membership_brand_location_model.sql` (ticket #4) is the real tenant/membership/brand/location schema and the pattern to copy for further tenant-scoped tables: explicit `tenant_id` + RLS policy in the same migration. The earlier `20260801030000_example_tenant_isolation_pattern.sql` was a disposable reference-only migration (no real domain table) and has been superseded -- don't copy it for new work, but its comments on what it does _not_ cover (Layer 0 / guest paths) still apply and are covered in `docs/security/tenant-isolation.md`.
- `supabase/seed.sql` is the seed-script skeleton run by `supabase db reset`; currently a no-op until real domain tables exist.
- CI validates migrations via `.github/workflows/migration-check.yml`, which runs `supabase start` (applies all migrations against a fresh local Postgres) followed by `supabase db lint` on every PR touching `supabase/**`.
- Local env vars live in `.env.example` at the repo root; copy to `.env.local` and the values already match Supabase's well-known local-dev defaults -- no manual key lookup needed for local work.

## Background processing

No dedicated queue system in the MVP. Email delivery, webhook handling, retryable integration sync, analytics aggregation, and scheduled availability changes use the simplest reliable mechanism the platform supports (Supabase Edge Functions / scheduled functions, Next.js route handlers). A dedicated queue is introduced only when a measured requirement justifies it (§13.4 of the source brief).

## Observability

- Errors: Sentry (free Developer tier — see service register).
- Uptime: Better Stack (free tier — see service register for why UptimeRobot was rejected).
- Product usage (of the SaaS app itself, not restaurant sales): PostHog.

## Backups (free-tier — resolves a contradiction flagged by the Opus architecture review)

Supabase's free tier includes no managed backups. Since the user requires an entirely free setup, production backups are a scheduled GitHub Actions job (within the free 2,000 min/month budget) running `pg_dump` against the Supabase database and uploading the encrypted dump to a Cloudflare R2 bucket (R2 free tier: 10 GB storage, no egress fee — same Cloudflare account already used for hosting). A restore is tested at least once before the first real pilot tenant goes live, and that test is itself a `/release-check` item, not assumed to work.

## Release checklist (`/release-check`)

Before any staging→production promotion: migrations validated, environment variables verified, observability wired up, the free-tier backup job has a verified recent successful run and a tested restore, smoke tests green. Never deploys to production itself — it only validates readiness; the actual production deploy always needs separate explicit human approval.
