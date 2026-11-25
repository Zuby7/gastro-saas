# Tenant Isolation

## Rule

Tenant A must never read, modify, or infer Tenant B's data - menu, orders, analytics, users, payment configuration, images, ratings, or settings. This is a top-priority invariant, enforced at two independent layers.

## Layer 1: Application authorization

- Every request resolves the acting user's tenant membership server-side before touching data. The tenant context never comes from a client-supplied `tenant_id` - it comes from the authenticated session's membership record.
- Authorization checks (`.claude/rules/auth.md`) run server-side, on every mutation and every sensitive read. Hiding a button in the UI is never treated as authorization.
- Public endpoints (public menu, public restaurant profile) go through deliberately designed public query functions that only ever select published, non-sensitive columns for one restaurant at a time - never a generic "list all tenants" or "list all X" query.

## Layer 0: Unauthenticated (guest) paths

Guest checkout (`docs/product/mvp-scope.md`) means cart creation, order creation, and rating submission all happen **without a membership**. Layers 1 and 2 as stated above assume an authenticated session and don't yet define this path - that gap is closed here:

- A guest write always resolves its tenant from the **public route** (the tenant slug in the URL), resolved server-side into a `tenant_id` before any write - never from a client-supplied `tenant_id` in the request body.
- Guest writes execute through a server-side client using a scoped service role, not the Postgres `anon` role directly - there are no direct `anon` INSERT/UPDATE grants on tenant-scoped tables. The server-side handler is the only thing allowed to write on a guest's behalf, and it always stamps the resolved `tenant_id` itself.
- Guest reads (order status page) use a token, not a membership: the token must be cryptographically random (≥128 bits), single-purpose (order status only), and never sequential/guessable. RLS for the token-read path checks the token against the specific row, not the tenant broadly.
- The digital receipt page (`/r/[slug]/orders/[token]/beleg`, ticket #153) reuses exactly this token-read path (`get_order_status_by_token`, no new RPC/migration): unknown token and token-of-another-tenant-under-the-wrong-slug render the same generic "not found" page, and unpaid/cancelled orders render a neutral "no receipt yet" page. It only renders server-provided data.
- Every ticket that adds a guest-facing write or token-read (cart, order, rating) needs a cross-tenant test proving: a guest checking out against Tenant A's slug can never create or read a row under Tenant B, and a guessed/incremented token never returns another customer's order.

## Layer 2: Database Row Level Security (Postgres/Supabase)

- Every tenant-scoped table has an explicit `tenant_id` column and an RLS policy restricting rows to the caller's tenant membership.
- RLS is the safety net if an application-layer check is ever missed - it must never be the _only_ layer, and it must never be disabled "temporarily" for convenience.
- Every new tenant-scoped table's migration must ship its RLS policy in the same migration - no follow-up ticket to "add RLS later."

## Testing requirement

Every ticket touching a tenant-scoped table needs a cross-tenant test: create two tenants with intentionally similar data, prove Tenant A's session cannot read or write Tenant B's rows for the entity in question, at both the API layer and (where practical) directly against RLS. This is part of the Definition of Done - see `.claude/rules/testing.md`.

## Known risk areas

- Insecure direct object references (guessable/sequential order or dish IDs used without a membership check).
- Storage objects (media assets) - the bucket stays private; `/media/*` authorizes each path against published, non-archived dishes and streams the bytes server-side. Accepted cache window: after a dish is unpublished or archived, already served photos can remain in public caches for up to 1 day (`max-age`) plus 1 day (`stale-while-revalidate`); image paths are unguessable UUIDs.
- Analytics aggregates - a bug here is easy to miss because the numbers "look plausible" for the wrong tenant; analytics queries must always filter by tenant first, not last.
- Integration sync jobs - a shared mock/real provider must never leak one tenant's menu/order data into another tenant's sync payload.

## Hardening after the 2026-11 audit (issue #205)

The storage cache window after unpublish is described under Known risk areas above; HTTP-level hardening (issue #204) is in [architecture-overview.md](../development/architecture-overview.md).

Migration `20261121090000_db_hardening_audit_2026_11.sql` closes these gaps (each covered by `packages/database/src/db-hardening-audit-2026-11.integration.test.ts`):

- **Tenant export**: `export_tenant_data()` requires `tenant.data.delete` (Owner only) inside the function, matching the `/api/account/privacy/export` route, so a Manager cannot call the RPC directly.
- **Function privileges**: `revoke ... from public` does not remove the explicit grants Supabase gives `anon`/`authenticated` on new functions. `anon` may now execute only `get_public_menu` and `get_public_legal_page`; every service_role-only function (checkout, cart, webhook, refund finalization, rate limiting, purge jobs) is explicitly revoked from `anon` and `authenticated`. The integration tests ("anon may execute only the public guest RPCs", "authenticated may execute only its allow-list") fail if any other public function becomes executable. New functions must be added to the allow-list in `packages/database/src/db-hardening-audit-2026-11.integration.test.ts` deliberately.
- **No direct writes for forged facts**: `audit_logs` and `analytics_events` are no longer client-writable (INSERT policy dropped and INSERT revoked for `authenticated`); signed-in audit rows go through `record_audit_event()` (actor is always `auth.uid()`, caller must be a tenant member).
- **Refunds**: the authenticated INSERT policy only admits a `pending` reservation without `stripe_refund_id` and with `actor_user_id = auth.uid()`.
- **Role escalation**: granting a role (`membership_roles` INSERT) or inviting into a role requires `roles.manage` or that the role's permissions are a subset of the caller's; `owner` additionally always requires `roles.manage`. `accept_invitation` leaves the member with exactly the invited role and rejects accounts that already belong to a tenant.
- **Menu versions**: app roles can only INSERT drafts, DELETE only drafts, and the editable-version guard checks both OLD and NEW parent.
- **Manual sales**: `dish_id` must belong to the entry's tenant; `entered_by_user_id` is forced to `auth.uid()` for app roles (also in `commit_sales_import_batch`).
