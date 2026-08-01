---
name: implement-ticket
description: Execute exactly one prepared (Ready) gastro-saas ticket using the sonnet-implementer subagent, avoiding unrelated refactoring, and return implementation evidence.
---

Run in a focused context; operates on exactly one Ready ticket.

## Steps

1. Confirm the ticket is Ready (see `/prepare-ticket`). If not, stop and say so.
2. Invoke the `sonnet-implementer` subagent with the ticket content and the relevant ADRs/rules only.
3. Ensure deterministic checks relevant to the change ran (lint, typecheck, unit/integration tests, build, migration validation, secret scan).
4. Return: summary, changed files, commands run + pass/fail, tests added/updated, docs updated, unresolved concerns. No unrelated refactoring is allowed to slip in — flag it if the implementer did any and ask before keeping it.
