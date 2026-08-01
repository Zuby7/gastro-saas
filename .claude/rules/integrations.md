---
description: External integration rules — POS, delivery marketplaces, mock provider
paths: ["packages/domain/integrations/**"]
---

- Only official, authorized partner APIs — no scraping, no reverse engineering of protected merchant portals, ever.
- Use the mock integration provider for all development and testing; clearly label any real adapter as implemented vs. placeholder.
- The master menu is always the source of truth unless a documented integration mode says otherwise.
- Integration sync jobs are retryable with dead-letter handling and reconciliation — a failed sync must never silently disappear.
- A shared/mock provider must never leak one tenant's data into another tenant's sync payload.
