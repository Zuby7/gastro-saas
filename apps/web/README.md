# @gastro-saas/web

Next.js (App Router) app for gastro-saas. Part of the pnpm workspace at the repo root — see the
root `README.md`.

```bash
pnpm dev        # from repo root, or `pnpm --filter @gastro-saas/web dev` from anywhere
```

Environment variables go in `apps/web/.env.local` (copy the repo-root `.env.example`).

Docs: setup and tests in `docs/development/getting-started.md`, routes and `src/lib` modules in
`docs/development/routes-and-modules.md`, system design in `docs/development/architecture-overview.md`.

Hosting target is Cloudflare Workers (`@opennextjs/cloudflare`), not Vercel — see
`docs/architecture/adr/0001-stack-and-modular-monolith.md` and `docs/operations/deployment-strategy.md`.
