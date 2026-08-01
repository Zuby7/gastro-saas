---
name: validate-ticket
description: Independently validate gastro-saas work using the opus-validator subagent, either immediately for one high-risk ticket or in a batch at the end of an epic, reviewing only the relevant docs, diff, and evidence, and return the required structured verdict.
---

Per-ticket mode is now the active default for every ticket (revised 2026-08-01, after Epic 1's batch review — see `CLAUDE.md`'s Opus validation cadence). Epic-batch mode is kept below only as a documented fallback, not currently used.

## Per-ticket mode (active default — every ticket, regardless of risk label)

1. Gather: the ticket's acceptance criteria, the Git diff for that ticket, changed files, and deterministic-check evidence from `/implement-ticket`.
2. Invoke `opus-validator` (Opus 5, `model: opus`) with exactly this material — not the whole repo.
3. Save the verdict under `artifacts/reviews/issue-<number>.json`.

## Epic-batch mode (fallback only, not the active default)

1. Gather: all tickets closed since the last epic review, their combined acceptance criteria, the cumulative diff since the last reviewed commit for this epic, and deterministic-check evidence for each.
2. Invoke `opus-validator` once against the batch — cite which findings belong to which ticket.
3. Save the verdict under `artifacts/reviews/epic-<number>.json`.
4. If `APPROVED`: close the milestone. If `CHANGES_REQUESTED`: file the findings back against the specific tickets that caused them (reopen if already closed) rather than a vague "epic-wide" fix.

## Both modes

Report the verdict (`APPROVED` / `CHANGES_REQUESTED` / `BLOCKED`) and, if not approved, the required actions — nothing is silently fixed by this skill itself.
