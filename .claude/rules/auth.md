---
description: Authentication & authorization rules
paths: ["packages/domain/identity/**", "packages/domain/authorization/**"]
---

- Permission keys follow `area.resource.action` (e.g. `menu.publish`, `payments.refund`, `orders.cancel`, `roles.manage`) — define new keys in `docs/data/domain-model.md` and the ticket, don't invent ad-hoc strings per feature.
- Server-side authorization on every mutation and sensitive read. UI hiding a button/menu item is never sufficient on its own.
- Standard role templates (Owner, Manager, Kitchen, Service, Marketing) are starting points — tenants can define custom roles with fine-grained permission sets.
- At least one Owner membership per tenant at all times — enforced at the data layer, not just the UI, to prevent accidental lockout.
- Invitations are single-use, expiring, and scoped to one tenant + one role.
- Every permission boundary needs a test proving the _denied_ case, not just the allowed case (e.g. "kitchen role cannot read revenue").
