---
name: ship-ticket
description: Coordinate exactly one gastro-saas ticket from Ready to a reviewed pull request via prepare -> implement -> validate, enforcing a maximum of three repair cycles and never processing a second ticket in the same run.
---

Processes exactly one ticket per invocation. Never starts a second ticket in the same run.

## Opus cadence (see `CLAUDE.md`)

Opus validates immediately, per-ticket, for every ticket, regardless of risk label (revised 2026-08-01, after Epic 1's batch review — the end-of-epic batch mode is no longer the active default). `opus-validator` is always Opus 5 (`model: opus`, the current frontier Opus).

## Steps

1. `/prepare-ticket` — confirm Ready.
2. `/implement-ticket` — sonnet-implementer implements, deterministic checks run.
3. Open the pull request once deterministic checks are green — **never self-merge it in the same step, and never before Opus has reviewed it**.
4. `/validate-ticket` in per-ticket mode, always, for every ticket. Once (and only once) Opus returns `APPROVED`, self-merge without asking — standing user authorization (revised 2026-08-01, replaces the prior "every PR needs a human merge decision" rule), conditioned unconditionally on the Opus `APPROVED` gate. No risk-label exception, no "trivial/docs-only" exception.
5. If `CHANGES_REQUESTED`: sonnet-implementer fixes the listed findings, deterministic checks re-run, opus-validator re-reviews. Repeat at most 3 times total per ticket.
6. If still not `APPROVED` after 3 cycles: mark `BLOCKED`, write a concise blocker report (precise unresolved issue + what human decision/credential is needed), and stop — do not weaken criteria, disable tests, or remove security checks to force a pass.
7. Mark the ticket Done once its PR is merged and docs are complete.
