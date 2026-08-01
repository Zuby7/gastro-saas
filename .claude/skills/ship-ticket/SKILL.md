---
name: ship-ticket
description: Coordinate exactly one gastro-saas ticket from Ready to a reviewed pull request via prepare -> implement -> validate, enforcing a maximum of three repair cycles and never processing a second ticket in the same run.
---

Processes exactly one ticket per invocation. Never starts a second ticket in the same run.

## Steps

1. `/prepare-ticket` — confirm Ready.
2. `/implement-ticket` — sonnet-implementer implements, deterministic checks run.
3. `/validate-ticket` — opus-validator reviews.
4. If `CHANGES_REQUESTED`: sonnet-implementer fixes the listed findings, deterministic checks re-run, opus-validator re-reviews. Repeat at most 3 times total.
5. If still not `APPROVED` after 3 cycles: mark the ticket `BLOCKED`, write a concise blocker report (precise unresolved issue + what human decision/credential is needed), and stop — do not weaken criteria, disable tests, or remove security checks to force a pass.
6. If `APPROVED`: open/update the pull request with the ticket link, acceptance-criteria checklist, test evidence, and the Opus verdict; mark the ticket Done only once the PR, evidence, and docs are complete.
