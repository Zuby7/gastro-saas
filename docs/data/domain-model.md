# Domain Model

Entities are introduced through tickets as they're needed (§12 of the source brief) — this document is the target shape, not a mandate to create every table immediately.

## Identity & tenancy

`users`, `tenants`, `tenant_memberships`, `brands`, `locations`, `invitations`.

> **Implemented (ticket #4):** `tenants`, `tenant_memberships`, `brands`, `locations` and their RLS policies ship in
> `supabase/migrations/20260801040000_tenant_membership_brand_location_model.sql`. `tenant_memberships` currently
> carries a minimal fixed `role` column (`owner` | `manager` | `staff`) rather than the full RBAC tables below — those
> land with ticket #9. A tenant is guaranteed at least one Owner membership at all times via two deferred
> database constraint triggers — one on `tenant_memberships` (covering delete/demote/re-parent of the last Owner)
> and one on `tenants` (covering a tenant inserted with zero memberships) — see the migration's header comment.
> All SECURITY DEFINER helper functions use `search_path = ''` with fully schema-qualified references to prevent
> a `pg_temp` table-shadowing RLS bypass. **Prerequisite for future onboarding/account-deletion tickets:** because
> `tenant_memberships.user_id` cascades from `auth.users`, deleting the `auth.users` row of a tenant's sole Owner
> now fails at commit (the Owner-guard trigger aborts the whole `DELETE`) — an ownership transfer or full tenant
> deletion must happen first. `users` and `invitations` are not yet implemented (tickets #7/#8).

## Authorization

`roles`, `permissions`, `role_permissions`, `membership_roles`. Permission keys follow `area.resource.action`, e.g. `menu.publish`, `payments.refund`, `orders.cancel`, `audit.read` (ticket #6 — defined here, not yet enforced anywhere; no read function/endpoint exists yet) — full list in `.claude/rules/auth.md`.

## Restaurant profile

`restaurant_profiles`, `opening_hours`, `fulfillment_settings`, `payment_accounts` (Stripe Connect account reference, onboarding status).

## Tax

`tax_categories` (name, rate, valid-from date) assignable per dish/category, resolved **per fulfillment method** (e.g. German reduced rate for takeaway/pickup vs. standard rate for dine-in/table service can legally differ) at order-item creation time and snapshotted onto the order item like price. Rate correctness is the tenant's legal responsibility (`docs/security/threat-model.md`); the platform only stores and applies whatever rate the tenant configured.

## Menu

`menu_versions`, `menus`, `categories`, `dishes`, `dish_variants`, `option_groups`, `options`, `dish_option_group_assignments`, `ingredients`, `removable_ingredients`, `allergens`, `additives`, `dietary_labels`, `dish_allergen_assignments`, `dish_additive_assignments`, `media_assets`, `availability_schedules`, `channel_availability`.

## Ordering

`carts`, `cart_items`, `cart_item_selections`, `orders`, `order_items`, `order_item_selections`, `order_status_events`.

## Payments

`payments`, `refunds`, `payment_webhook_events`.

## Analytics

`analytics_events`, `daily_analytics_aggregates`.

## Reviews

`ratings`, `rating_moderation`.

## Integrations

`integration_accounts`, `integration_sync_jobs`, `integration_errors`.

## Audit

`audit_logs` (append-only, tenant-scoped, immutable — no UPDATE/DELETE from application code) and `analytics_events` (Grundgerüst only, no aggregation logic — that's Epic 9). Write-only via `recordAuditEvent()` in `packages/domain/src/audit`, which rejects secret-/payment-shaped metadata before it reaches the table. See `docs/security/threat-model.md`'s audit section and `supabase/migrations/20260801050000_audit_log_and_analytics_events_skeleton.sql`.

## Cross-cutting rules

- **Tenant ownership**: every tenant-scoped table has an explicit `tenant_id` column, even where it could technically be inferred through a join — see `docs/security/tenant-isolation.md`.
- **Money**: integer minor units (cents), never floating point. Every monetary table has an explicit `currency` column.
- **Order immutability**: `order_items`/`order_item_selections` store a purchase-time snapshot (name, price, tax, variant, extras) independent of the live `dishes`/`dish_variants` rows, so later menu edits never rewrite history.
- **Soft delete over hard delete**: menu entities that participate in historical orders are archived, not deleted, to preserve order integrity.
- **Public data**: the public menu/restaurant-profile read path goes through deliberately scoped public queries — no table is broadly world-readable by default.
