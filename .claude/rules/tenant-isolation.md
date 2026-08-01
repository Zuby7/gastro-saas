---
description: Tenant isolation — the platform's top invariant
paths: ["packages/domain/**", "packages/database/**", "apps/web/src/app/api/**"]
---

Full detail: `docs/security/tenant-isolation.md`. Summary rules for any code touching tenant data:

- Two enforcement layers, always both: server-side membership/authorization check + Postgres RLS policy. Neither alone is sufficient.
- Tenant context comes only from the authenticated session's membership record — never from a client-supplied ID, header, or hidden form field.
- Any ticket that touches a tenant-scoped table requires a cross-tenant test: two seeded tenants with similar data, prove neither can read/write the other's rows.
- Public (unauthenticated) read paths use dedicated, narrowly-scoped public query functions — never a generic "select from this table" that happens to filter by ID.
- Storage objects (dish images, etc.) are scoped by tenant-prefixed paths with matching storage policies — no globally-readable bucket for tenant-owned files.
