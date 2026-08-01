---
name: prepare-ticket
description: Select or normalize one gastro-saas ticket to Ready - confirm dependencies, acceptance criteria, affected areas, required tests, and tenant/security/payment/analytics/accessibility risks.
---

Operates on exactly one ticket.

## Steps

1. Read the ticket (GitHub Issue or `docs/tickets/*.md`).
2. Confirm/fill the template fields (§22.3): scope, non-goals, dependencies, acceptance criteria, UI states, API/DB impact, tenant-isolation impact, permission impact, security impact, payment impact, analytics impact, accessibility impact, observability impact, required tests, migration/rollback notes, doc updates, definition of done.
3. Check Definition of Ready: objective clear, acceptance criteria testable, dependencies satisfied, affected domain identified, security/tenant risks identified, required external credentials available or explicitly mocked, scope fits one focused PR.
4. If the ticket is too large for one PR, split it and say so rather than proceeding with an oversized ticket.
5. Update the GitHub Issue (or local ticket file) and report readiness status.
