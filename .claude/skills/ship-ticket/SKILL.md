---
name: ship-ticket
description: Coordinate exactly one gastro-saas ticket from Ready to a reviewed pull request via prepare -> implement -> validate, enforcing a maximum of three repair cycles and never processing a second ticket in the same run.
---

Processes exactly one ticket per invocation. Never starts a second ticket in the same run.

## Opus cadence (see `CLAUDE.md`)

Opus validates immediately, per-ticket, only if the ticket touches payments/webhooks/refunds, auth/authorization/permissions, a tenant-scoped migration/RLS policy, or is labelled `risk:security`/`risk:tenant-isolation`/`risk:payment`/`risk:migration`/`risk:privacy`. Everything else merges after deterministic checks pass and rolls into the end-of-epic Opus review instead (see `/validate-ticket`'s epic mode). Don't invoke `opus-validator` per-ticket for non-risk-labelled tickets — that defeats the point of batching.

## Steps

1. `/prepare-ticket` — confirm Ready.
2. `/implement-ticket` — sonnet-implementer implements, deterministic checks run.
3. Open the pull request once deterministic checks are green, regardless of category — **never self-merge it in the same step**.
4. If this ticket is in the immediate-validation category above: `/validate-ticket` in per-ticket mode now, and only merge after an explicit human go-ahead (payments/auth/tenant-migration/risk-labelled tickets always need a human merge decision, never an automatic one — confirmed policy, 2026-08-01).
5. Otherwise (no risk label): leave the PR open and queue the ticket for the end-of-epic batch review. **Merge automatically only once the epic-batch Opus review returns `APPROVED`** for the epic containing this ticket (confirmed policy, 2026-08-01) — merging before that review, or merging a PR you authored yourself without this gate, is not authorized.
6. If `CHANGES_REQUESTED` (per-ticket or at the epic batch): sonnet-implementer fixes the listed findings, deterministic checks re-run, opus-validator re-reviews. Repeat at most 3 times total per validated unit (ticket or epic).
7. If still not `APPROVED` after 3 cycles: mark `BLOCKED`, write a concise blocker report (precise unresolved issue + what human decision/credential is needed), and stop — do not weaken criteria, disable tests, or remove security checks to force a pass.
8. Mark the ticket Done once its PR is merged and docs are complete.
