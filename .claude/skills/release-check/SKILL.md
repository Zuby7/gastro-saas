---
name: release-check
description: Validate staging readiness for gastro-saas before a potential production promotion - migrations, environment variables, observability, backups/rollback, smoke tests. Never deploys to production itself.
---

Never deploys to production. Only validates readiness; any actual production deploy requires separate explicit human approval per `docs/operations/deployment-strategy.md`.

## Steps

1. Verify migrations are applied and match the migration files in the repo.
2. Verify required environment variables are set for staging (without printing their values).
3. Verify observability is wired up (Sentry, Better Stack, PostHog) and receiving data.
4. Verify a backup/rollback plan exists for the current state.
5. Run smoke tests against staging.
6. Report a pass/fail checklist. If everything passes, state clearly that production deployment still requires the user's explicit approval — do not proceed on its own.
