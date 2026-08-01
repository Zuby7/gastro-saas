# Deployment Strategy

## Environments

| Environment | Trigger | Approval |
|---|---|---|
| Local | `pnpm dev` | none |
| Preview | every PR | automatic |
| Staging | manual promotion from a merged PR | automatic, run `/release-check` first |
| Production | explicit request | **always requires explicit human approval** — both the deploy itself and any migration run against it |

## Hosting

Cloudflare Pages/Workers via `@opennextjs/cloudflare` (see ADR-0001, `docs/platform/service-register.md`). Free `*.pages.dev` subdomain until a real domain is purchased (a deliberate later step, not part of this foundation pass).

## Database migrations

- Every schema change ships as a migration file + its RLS policy in the same migration.
- Migrations run automatically against local/preview/staging.
- Migrations against production require explicit approval and a documented rollback note in the PR.

## Background processing

No dedicated queue system in the MVP. Email delivery, webhook handling, retryable integration sync, analytics aggregation, and scheduled availability changes use the simplest reliable mechanism the platform supports (Supabase Edge Functions / scheduled functions, Next.js route handlers). A dedicated queue is introduced only when a measured requirement justifies it (§13.4 of the source brief).

## Observability

- Errors: Sentry (free Developer tier — see service register).
- Uptime: Better Stack (free tier — see service register for why UptimeRobot was rejected).
- Product usage (of the SaaS app itself, not restaurant sales): PostHog.

## Release checklist (`/release-check`)

Before any staging→production promotion: migrations validated, environment variables verified, observability wired up, backups/rollback plan confirmed, smoke tests green. Never deploys to production itself — it only validates readiness; the actual production deploy always needs separate explicit human approval.
