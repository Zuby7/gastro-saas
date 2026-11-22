# Code health (living page)

Known tech debt with ticket links and commands to measure it. Update this page in the same PR that adds, pays off or re-measures an item. Last measured: 2026-11-22 on `main` at `b0f85c4`.

## Oversized files

Large files mix several concerns and are hard to review. Lines (non-test files under `apps/web/src`):

| File                                          | Lines | Concern                                                   | Ticket                                         |
| --------------------------------------------- | ----- | --------------------------------------------------------- | ---------------------------------------------- |
| `app/account/menu/dishes/[dishId]/actions.ts` | 839   | Every dish editor server action in one file               | none yet (needs a ticket before splitting)     |
| `lib/payments/webhook-service.ts`             | 620   | Event routing, order/payment transitions, review flagging | #209 (error handling residue), split not filed |
| `lib/payments/refund-service.ts`              | 559   | Reservation, Stripe call, finalisation, reconciliation    | none yet                                       |
| `app/page.tsx`                                | 495   | Whole marketing landing page in one component             | none yet                                       |

Measure:

```bash
git ls-files 'apps/web/src/**/*.ts' 'apps/web/src/**/*.tsx' | grep -vE '\.test\.' | xargs wc -l | sort -rn | head -15
```

Rule of thumb: above roughly 400 lines, split by concern when you next touch the file for a feature; never mix a split with behaviour changes (the performance PR #208 explicitly excluded splits).

## Rate limits and abuse

- Cart creation has no per-IP limit: #210 (needs a migration for a new `auth_rate_limit_attempts` scope).
- Mollie payments can stay open after the timeout sweep cancels an order: #200. Mollie as a whole: #195 (PR #201 open).

Measure: `git grep -n "rate-limit" apps/web/src/lib/auth/rate-limit.ts` and the scope list in the `auth_rate_limit_attempts` CHECK constraint (`git grep -n "auth_rate_limit_attempts" supabase/migrations`).

## Privacy and retention

- Hashed visitor IPs are purged by pg_cron only after the SQL of migration `20260906170000` is run on the hosted project: #164 (open, `status:blocked-on-external`).
- `analytics_events` retention is not scheduled, only on demand and on deletion requests (see the threat model).

Measure on the hosted project: `select jobname, schedule from cron.job;` and `select status, return_message from cron.job_run_details order by start_time desc limit 10;`.

## Auth and data access duplication

`supabase.auth.getUser()` is called in many server actions and pages, each repeating the same user, membership and permission lookup. The performance PR #208 (issue #203) introduces a cached account-context helper for the account pages; remaining call sites should migrate to it.

Measure:

```bash
git grep -h "auth.getUser()" -- apps/web/src ':!*.test.*' | wc -l    # 43 call sites on 2026-11-22
git grep -l "auth.getUser()" -- apps/web/src ':!*.test.*' | wc -l    # 34 files
```

## Security headers

The static CSP in `apps/web/next.config.ts` allows `'unsafe-inline'` for scripts and styles (Next.js inline bootstrap). Follow-up: nonce-based CSP via middleware, which also needs the Cloudflare adapter to pass the nonce to inline scripts. No ticket yet; related audit ticket #204.

Measure: `git grep -n "unsafe-inline" apps/web/next.config.ts`.

## Other known gaps

- No CD pipeline for the Worker, Sentry not integrated (#89): see [deployment-strategy.md](../operations/deployment-strategy.md).
- Transitional fallback in `apps/web/src/lib/audit/record-menu-admin-audit-event.ts` can be deleted once the hosted DB has migration `20261121090000` (#205).
- Playwright is local-only (one spec), not a CI gate: [test-strategy.md](../testing/test-strategy.md).

## Test and coverage health

```bash
pnpm --filter @gastro-saas/web test:coverage   # must stay above the floor in apps/web/vitest.config.mts
git ls-files | grep -cE '\.test\.tsx?$'        # number of test files
```

## Backlog hygiene

Every merged PR must reference an issue; compare with `gh pr list --state merged --limit 50 --json number,closingIssuesReferences --jq '.[]|select(.closingIssuesReferences==[])|.number'`.
