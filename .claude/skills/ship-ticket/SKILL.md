---
name: ship-ticket
description: Coordinate exactly one gastro-saas ticket from Ready to a reviewed pull request via prepare -> implement -> validate, enforcing a maximum of three repair cycles and never processing a second ticket in the same run.
---

Processes exactly one ticket per invocation. Never starts a second ticket in the same run.

## Opus cadence (see `CLAUDE.md`)

Opus validates once per epic, at the end, against the full accumulated diff (revised a fourth time 2026-08-01 — back to batching, for development speed). Risk-labelled tickets (`risk:security`/`risk:payment`/`risk:migration`/`risk:privacy`, or anything touching payments/auth/tenant-migrations) get an immediate same-model Sonnet self-check at ticket completion instead of an immediate Opus review — a weaker but fast independent-invocation pass that still catches obvious issues before the epic-end Opus review sees the same diff. `opus-validator` is always Opus 5 (`model: opus`).

## Steps

1. `/prepare-ticket` — confirm Ready.
2. `/implement-ticket` — sonnet-implementer implements, deterministic checks run.
3. If the ticket is risk-labelled: run a fresh `sonnet-implementer`-model invocation as a self-check reviewer (new context, not the one that wrote the diff) against the ticket's diff; fix anything it flags before moving on.
4. Open the pull request once deterministic checks (and the risk-ticket self-check, if applicable) are green — **never self-merge it in the same step**.
5. Queue the ticket for the end-of-epic Opus batch review (`/validate-ticket` epic-batch mode) — do not invoke `opus-validator` per-ticket.
6. Once the epic-batch Opus review returns `APPROVED` for the epic containing this ticket, self-merge without asking (standing user authorization, conditioned unconditionally on that Opus `APPROVED` gate — no exceptions).
7. If the epic-batch verdict is `CHANGES_REQUESTED`: route findings back to the specific tickets that caused them, sonnet-implementer fixes, deterministic checks re-run, re-submit for the next epic-batch pass. Repeat at most 3 times total per epic.
8. If still not `APPROVED` after 3 cycles: mark the epic `BLOCKED`, write a concise blocker report, and stop — do not weaken criteria, disable tests, or remove security checks to force a pass.
9. Mark the ticket Done once its PR is merged and docs are complete.
