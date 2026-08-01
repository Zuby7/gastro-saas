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
