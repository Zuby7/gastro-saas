---
description: Security rules — applies broadly, especially auth/payments/uploads/webhooks
paths: ["packages/domain/**", "apps/web/src/app/api/**"]
---

Full threat model: `docs/security/threat-model.md`. Non-negotiables:

- No secrets in the browser, logs, or commits. `.env*` is hook-blocked from being committed.
- Server-side authorization on every mutation and sensitive read — never rely on UI hiding.
- Parameterized queries only — no hand-built SQL strings.
- Webhook signature verification + idempotency on every inbound webhook.
- File uploads: allow-listed types, size limits, re-encoding, tenant-scoped storage paths.
- Run `/security-gate` for any ticket touching auth, authorization, tenant boundaries, payments, refunds, webhooks, uploads, public APIs, integrations, secrets, user data, deployment, or DB policies — these tickets also require explicit Opus security review, not just the standard validation pass.
