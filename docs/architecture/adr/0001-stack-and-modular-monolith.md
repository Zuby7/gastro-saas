# ADR-0001: Stack and Modular Monolith

- Status: Accepted
- Date: 2026-08-01

## Context

gastro-saas needs to ship an MVP fast, stay free-tier-friendly per the user's explicit requirement, support strict multi-tenant isolation, and remain simple enough for a solo owner-operator to use, while leaving room to grow into a multi-location, integration-rich platform later.

## Decision

- **Language**: TypeScript, strict mode, everywhere (app, domain, database layer).
- **Framework**: Next.js (App Router) — server actions/route handlers double as the API layer, SSR for the public menu (SEO + performance), one deployable app.
- **Package manager**: pnpm (workspaces), via Corepack/npm-global fallback (see `docs/decisions/assumptions.md` for the local install path used on this machine).
- **Database/Auth/Storage**: Supabase (managed Postgres, Row Level Security, built-in auth, object storage) — free tier is generous enough for MVP + first pilot tenant, and RLS gives a real second enforcement layer for tenant isolation, not just an ORM convention.
- **Payments**: Stripe + Stripe Connect, test mode until explicit production approval.
- **Hosting**: Cloudflare Pages/Workers via `@opennextjs/cloudflare`, chosen over Vercel specifically because Vercel's free Hobby tier prohibits commercial use — see `docs/platform/service-register.md`.
- **Validation**: Zod schemas at every server boundary (API input, webhook payloads, form submissions).
- **Testing**: Vitest (unit/integration), Playwright (E2E + accessibility checks).
- **Architecture style**: modular monolith (see `domain-boundaries.md`), not microservices.

## Alternatives considered

- **Vercel** for hosting — rejected as the _default_ only because of the commercial-use ToS restriction on the free tier; documented as a fallback for non-commercial previews.
- **Microservices from day one** — rejected: adds operational overhead (service discovery, distributed transactions, multiple deploy pipelines) the MVP doesn't need. Module boundaries are enforced in code now so extraction later is possible without a rewrite.
- **Firebase** instead of Supabase — rejected: weaker relational/RLS story for the tenant-isolation and reporting-heavy analytics requirements; Postgres is a better fit for the join-heavy analytics queries (topsellers, extras, trends).
- **Prisma-style full ORM** vs. typed SQL/Supabase client — left open, to be decided at the first database-touching ticket rather than upfront.

## Consequences

- Cloudflare's Next.js support goes through a community adapter, not first-party — some very recent Next.js features may lag; mitigated by pinning Next.js to a version confirmed compatible with the adapter at scaffold time.
- Free-tier Supabase projects pause after 7 days of inactivity — acceptable for MVP development, must be monitored once a real pilot tenant is live.
- Choosing RLS as a real enforcement layer (not just documentation) means every tenant-scoped table needs a policy from the day it's created — this is captured as a mandatory step in `.claude/rules/database-migrations.md` and `.claude/rules/tenant-isolation.md`.
