# gastro-saas

Multi-tenant SaaS platform for independent gastronomy businesses (cafés, pizzerias, restaurants, snack bars, bakeries, takeaways): manage the menu, accept orders, get paid securely, and understand what customers actually buy.

> Internal working name. No public brand name has been chosen yet.

## Status

Foundation phase. No product features are implemented yet — this repository currently contains the engineering foundation: product/architecture/security documentation, the Claude Code operating model (subagents, rules, skills, hooks), the service register, and the initial ticket backlog. See `docs/decisions/assumptions.md` for what was decided autonomously and what is still open.

## Documentation map

| Topic | Location |
|---|---|
| Product vision, MVP scope, non-goals | `docs/product/` |
| Architecture decisions (ADRs), system context, domain boundaries | `docs/architecture/` |
| Data model | `docs/data/domain-model.md` |
| Security: threat model, tenant isolation | `docs/security/` |
| External service choices (free-tier-first) | `docs/platform/service-register.md` |
| Test strategy | `docs/testing/test-strategy.md` |
| Deployment & operations | `docs/operations/deployment-strategy.md` |
| Assumptions made without asking | `docs/decisions/assumptions.md` |
| Ticket backlog (also on GitHub Issues) | `docs/tickets/` |

## Engineering workflow

Every ticket goes through: **Sonnet implements → deterministic checks (lint/typecheck/tests/build) → Opus validates**. See root `CLAUDE.md` for the full rule set, `.claude/agents/` for the `sonnet-implementer` and `opus-validator` subagent definitions, and `.claude/skills/` for the `/prepare-ticket` → `/implement-ticket` → `/validate-ticket` → `/ship-ticket` workflow.

## Stack (see ADR-0001 for reasoning)

TypeScript (strict), Next.js (App Router), PostgreSQL via Supabase (auth, storage, RLS), Stripe Connect (payments), Cloudflare Pages/Workers (hosting), pnpm.

## Getting started

Application code has not been scaffolded yet (Epic 1 tickets cover this). Once scaffolded:

```bash
pnpm install
pnpm dev
```

## License

Not yet decided — proprietary by default until the user says otherwise.
