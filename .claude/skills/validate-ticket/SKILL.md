---
name: validate-ticket
description: Independently validate exactly one gastro-saas ticket's implementation using the opus-validator subagent, reviewing only the relevant docs, diff, and evidence, and return the required structured verdict.
---

Run in an isolated context; operates on exactly one ticket's diff.

## Steps

1. Gather: the ticket's acceptance criteria, the Git diff, changed files, and deterministic-check evidence from `/implement-ticket`.
2. Invoke the `opus-validator` subagent with exactly this material — not the whole repo.
3. Save the structured verdict JSON under `artifacts/reviews/issue-<number>.json`.
4. Report the verdict (`APPROVED` / `CHANGES_REQUESTED` / `BLOCKED`) and, if not approved, the required actions — nothing is silently fixed by this skill itself.
