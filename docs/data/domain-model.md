# Domain Model

Entities are introduced through tickets as they're needed (§12 of the source brief) — this document is the target shape, not a mandate to create every table immediately.

## Identity & tenancy
`users`, `tenants`, `tenant_memberships`, `brands`, `locations`, `invitations`.

## Authorization
`roles`, `permissions`, `role_permissions`, `membership_roles`. Permission keys follow `area.resource.action`, e.g. `menu.publish`, `payments.refund`, `orders.cancel` — full list in `.claude/rules/auth.md`.

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
`audit_logs`.

## Cross-cutting rules

- **Tenant ownership**: every tenant-scoped table has an explicit `tenant_id` column, even where it could technically be inferred through a join — see `docs/security/tenant-isolation.md`.
- **Money**: integer minor units (cents), never floating point. Every monetary table has an explicit `currency` column.
- **Order immutability**: `order_items`/`order_item_selections` store a purchase-time snapshot (name, price, tax, variant, extras) independent of the live `dishes`/`dish_variants` rows, so later menu edits never rewrite history.
- **Soft delete over hard delete**: menu entities that participate in historical orders are archived, not deleted, to preserve order integrity.
- **Public data**: the public menu/restaurant-profile read path goes through deliberately scoped public queries — no table is broadly world-readable by default.
