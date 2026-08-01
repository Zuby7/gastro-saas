---
name: security-gate
description: Run deterministic security checks plus Claude Code's built-in security review for gastro-saas changes touching auth, tenant boundaries, payments, webhooks, uploads, public APIs, integrations, secrets, or deployment, and produce a concise report.
---

## Steps

1. Run available deterministic security tooling: dependency/secret scanning, and the built-in Claude Code security review where available (`/security-review`).
2. Cross-check the change against `docs/security/threat-model.md` and `docs/security/tenant-isolation.md` for the relevant threat categories.
3. Any security-sensitive finding requires an explicit `opus-validator` security review before the ticket can be marked `APPROVED` — this gate does not replace `/validate-ticket`, it feeds into it.
4. Produce a concise report: checks run, findings (severity, evidence, required correction), and whether the change is clear to proceed to validation.
