---
name: validate-ticket
description: Independently validate gastro-saas work using the opus-validator subagent, in a batch at the end of an epic, plus a fast same-model Sonnet self-check immediately for risk-labelled tickets, and return the required structured verdict.
---

Epic-batch mode is the active default for every ticket (revised a fourth time, 2026-08-01 — back to batching for development speed; see `CLAUDE.md`'s Opus validation cadence). Per-ticket Opus mode is kept below only as a documented fallback, not currently used. Risk-labelled tickets additionally get an immediate Sonnet self-check (not a full Opus review) at ticket completion — see below.

## Epic-batch mode (active default — every ticket, regardless of risk label)

1. Gather: all tickets closed since the last epic review, their combined acceptance criteria, the cumulative diff since the last reviewed commit for this epic, and deterministic-check evidence for each.
2. Invoke `opus-validator` (Opus 5, `model: opus`) once against the batch — cite which findings belong to which ticket.
3. Save the verdict under `artifacts/reviews/epic-<number>.json`.
4. If `APPROVED`: close the milestone, merge is authorized for every PR in the epic. If `CHANGES_REQUESTED`: file the findings back against the specific tickets that caused them (reopen if already closed) rather than a vague "epic-wide" fix; repeat at most 3 times total per epic before marking it `BLOCKED`.

## Risk-ticket immediate self-check (in addition to, not instead of, the epic-batch review above)

For any ticket labelled `risk:security`/`risk:payment`/`risk:migration`/`risk:privacy` (or touching payments/auth/tenant-migrations): immediately after `/implement-ticket`, run a fresh `sonnet-implementer`-model invocation (new context — not the same one that wrote the diff) as a self-check reviewer against just that ticket's diff. This is a same-model check, weaker than an independent stronger model, but fast — it exists to catch obvious issues before the epic-end Opus pass, not to replace it. Fix anything it flags before moving to the next ticket. This does NOT get its own `artifacts/reviews/issue-<n>.json` file (that's reserved for real Opus verdicts) — note findings/fixes in the PR description instead.

## Per-ticket Opus mode (fallback only, not the active default)

1. Gather: the ticket's acceptance criteria, the Git diff for that ticket, changed files, and deterministic-check evidence from `/implement-ticket`.
2. Invoke `opus-validator` with exactly this material — not the whole repo.
3. Save the verdict under `artifacts/reviews/issue-<number>.json`.

## All modes

Report the verdict (`APPROVED` / `CHANGES_REQUESTED` / `BLOCKED`) and, if not approved, the required actions — nothing is silently fixed by this skill itself.
