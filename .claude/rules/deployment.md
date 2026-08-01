---
description: Deployment & CI rules
paths: [".github/workflows/**", "wrangler.toml", "wrangler.jsonc"]
---

Full strategy: `docs/operations/deployment-strategy.md`. Non-negotiables:

- Preview/staging deploys may be automatic once configured; **production deployment always requires explicit human approval** — never trigger it automatically.
- Migrations against production require explicit approval and a documented rollback note.
- CI gate order: format → lint → typecheck → unit → integration → build → migration validation → secret scan → dependency/security scan → E2E smoke. A failed required check blocks merge.
- Never disable a required CI check or use `--no-verify`/skip-hooks to force a merge.
- Don't add a new external service without a defined requirement, owner, documented config, documented failure behavior, and an exit strategy — see `docs/platform/service-register.md`.
