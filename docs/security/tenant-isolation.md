# Tenant Isolation

## Rule

Tenant A must never read, modify, or infer Tenant B's data — menu, orders, analytics, users, payment configuration, images, ratings, or settings. This is a top-priority invariant, enforced at two independent layers.

## Layer 1: Application authorization

- Every request resolves the acting user's tenant membership server-side before touching data. The tenant context never comes from a client-supplied `tenant_id` — it comes from the authenticated session's membership record.
- Authorization checks (`.claude/rules/auth.md`) run server-side, on every mutation and every sensitive read. Hiding a button in the UI is never treated as authorization.
- Public endpoints (public menu, public restaurant profile) go through deliberately designed public query functions that only ever select published, non-sensitive columns for one restaurant at a time — never a generic "list all tenants" or "list all X" query.

## Layer 0: Unauthenticated (guest) paths

Guest checkout (`docs/product/mvp-scope.md`) means cart creation, order creation, and rating submission all happen **without a membership**. Layers 1 and 2 as stated above assume an authenticated session and don't yet define this path — that gap is closed here:

- A guest write always resolves its tenant from the **public route** (the tenant slug in the URL), resolved server-side into a `tenant_id` before any write — never from a client-supplied `tenant_id` in the request body.
- Guest writes execute through a server-side client using a scoped service role, not the Postgres `anon` role directly — there are no direct `anon` INSERT/UPDATE grants on tenant-scoped tables. The server-side handler is the only thing allowed to write on a guest's behalf, and it always stamps the resolved `tenant_id` itself.
- Guest reads (order status page) use a token, not a membership: the token must be cryptographically random (≥128 bits), single-purpose (order status only), and never sequential/guessable. RLS for the token-read path checks the token against the specific row, not the tenant broadly.
- Every ticket that adds a guest-facing write or token-read (cart, order, rating) needs a cross-tenant test proving: a guest checking out against Tenant A's slug can never create or read a row under Tenant B, and a guessed/incremented token never returns another customer's order.

## Layer 2: Database Row Level Security (Postgres/Supabase)

- Every tenant-scoped table has an explicit `tenant_id` column and an RLS policy restricting rows to the caller's tenant membership.
- RLS is the safety net if an application-layer check is ever missed — it must never be the _only_ layer, and it must never be disabled "temporarily" for convenience.
- Every new tenant-scoped table's migration must ship its RLS policy in the same migration — no follow-up ticket to "add RLS later."

## Testing requirement

Every ticket touching a tenant-scoped table needs a cross-tenant test: create two tenants with intentionally similar data, prove Tenant A's session cannot read or write Tenant B's rows for the entity in question, at both the API layer and (where practical) directly against RLS. This is part of the Definition of Done — see `.claude/rules/testing.md`.

## Known risk areas

- Insecure direct object references (guessable/sequential order or dish IDs used without a membership check).
- Storage objects (media assets) — signed URLs / storage RLS must scope to the owning tenant's path, never a globally-readable bucket.
- Analytics aggregates — a bug here is easy to miss because the numbers "look plausible" for the wrong tenant; analytics queries must always filter by tenant first, not last.
- Integration sync jobs — a shared mock/real provider must never leak one tenant's menu/order data into another tenant's sync payload.
