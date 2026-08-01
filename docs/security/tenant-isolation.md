# Tenant Isolation

## Rule

Tenant A must never read, modify, or infer Tenant B's data — menu, orders, analytics, users, payment configuration, images, ratings, or settings. This is a top-priority invariant, enforced at two independent layers.

## Layer 1: Application authorization

- Every request resolves the acting user's tenant membership server-side before touching data. The tenant context never comes from a client-supplied `tenant_id` — it comes from the authenticated session's membership record.
- Authorization checks (`.claude/rules/auth.md`) run server-side, on every mutation and every sensitive read. Hiding a button in the UI is never treated as authorization.
- Public endpoints (public menu, public restaurant profile) go through deliberately designed public query functions that only ever select published, non-sensitive columns for one restaurant at a time — never a generic "list all tenants" or "list all X" query.

## Layer 2: Database Row Level Security (Postgres/Supabase)

- Every tenant-scoped table has an explicit `tenant_id` column and an RLS policy restricting rows to the caller's tenant membership.
- RLS is the safety net if an application-layer check is ever missed — it must never be the *only* layer, and it must never be disabled "temporarily" for convenience.
- Every new tenant-scoped table's migration must ship its RLS policy in the same migration — no follow-up ticket to "add RLS later."

## Testing requirement

Every ticket touching a tenant-scoped table needs a cross-tenant test: create two tenants with intentionally similar data, prove Tenant A's session cannot read or write Tenant B's rows for the entity in question, at both the API layer and (where practical) directly against RLS. This is part of the Definition of Done — see `.claude/rules/testing.md`.

## Known risk areas

- Insecure direct object references (guessable/sequential order or dish IDs used without a membership check).
- Storage objects (media assets) — signed URLs / storage RLS must scope to the owning tenant's path, never a globally-readable bucket.
- Analytics aggregates — a bug here is easy to miss because the numbers "look plausible" for the wrong tenant; analytics queries must always filter by tenant first, not last.
- Integration sync jobs — a shared mock/real provider must never leak one tenant's menu/order data into another tenant's sync payload.
