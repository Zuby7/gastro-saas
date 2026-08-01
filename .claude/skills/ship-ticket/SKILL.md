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
3. If this ticket is in the immediate-validation category above: `/validate-ticket` in per-ticket mode now. Otherwise: merge once deterministic checks are green, and note the ticket for the end-of-epic batch review.
4. If `CHANGES_REQUESTED` (per-ticket or at the epic batch): sonnet-implementer fixes the listed findings, deterministic checks re-run, opus-validator re-reviews. Repeat at most 3 times total per validated unit (ticket or epic).
5. If still not `APPROVED` after 3 cycles: mark `BLOCKED`, write a concise blocker report (precise unresolved issue + what human decision/credential is needed), and stop — do not weaken criteria, disable tests, or remove security checks to force a pass.
6. If `APPROVED` (or deferred to the epic batch per step 3): open/update the pull request with the ticket link, acceptance-criteria checklist, and test evidence; mark the ticket Done once the PR and docs are complete. Non-immediate tickets record "Opus review: batched at epic close" instead of a per-ticket verdict.
