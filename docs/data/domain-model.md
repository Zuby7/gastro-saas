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

`roles`, `permissions`, `role_permissions`, `membership_roles`. Permission keys follow `area.resource.action`. Standard MVP permission keys:
`users.invite`, `users.manage`, `roles.manage`, `menu.publish`, `orders.cancel`, `payments.refund`, `analytics.read`, `audit.read`.
Ticket #9 introduces tenant-scoped standard roles (Owner, Manager, Kitchen, Service, Marketing), custom-role storage, `has_tenant_permission()` /
`require_tenant_permission()` server-side checks, and an `analytics.read` DB gate so revenue/analytics data is not visible to every tenant member.

## Restaurant profile

`restaurant_profiles`, `opening_hours`, `fulfillment_settings`, `payment_accounts` (Stripe Connect account reference, onboarding status).
Ticket #11 introduces `restaurant_profiles` and `opening_hours` with tenant-scoped RLS and timezone-aware profile storage. Admin UI: `apps/web/src/app/account/profile` (profile form + opening-hours editor, gated on `tenant.settings.write`).

## Tax

`tax_categories` (name, rate, valid-from date) assignable per dish/category, resolved **per fulfillment method** (e.g. German reduced rate for takeaway/pickup vs. standard rate for dine-in/table service can legally differ) at order-item creation time and snapshotted onto the order item like price. Rate correctness is the tenant's legal responsibility (`docs/security/threat-model.md`); the platform only stores and applies whatever rate the tenant configured.

## Menu

`menu_versions`, `menus`, `categories`, `dishes`, `dish_variants`, `option_groups`, `options`, `dish_option_group_assignments`, `ingredients`, `removable_ingredients`, `allergens`, `additives`, `dietary_labels`, `dish_allergen_assignments`, `dish_additive_assignments`, `media_assets`, `availability_schedules`, `channel_availability`.
Tickets #12-#15 introduce the draft/published menu foundation, tenant-scoped image metadata, variants/options/extras, restaurant-provided allergen/additive/dietary-label assignments, and server-side publish checks. Allergen/additive data is "provided by the restaurant"; the platform does not certify legal correctness.

Admin UI (added on top of the DB-only foundation above after the epic-3-5-batch Opus review flagged it as undelivered): `apps/web/src/app/account/menu` (categories/dishes editor + publish workflow) and `apps/web/src/app/account/menu/dishes/[dishId]` (variants, option groups/extras, allergen/additive/dietary-label assignment, image upload), gated on `menu.write`/`menu.publish`. Image upload goes through the private `dish-media` Supabase Storage bucket (tenant-prefixed paths, RLS policies in `supabase/migrations/20260802090000_menu_admin_ui_support.sql`); server-side re-encoding of uploaded images is deferred (github.com/Zuby7/gastro-saas/issues/72). A tenant's first draft `menu_versions` row is get-or-created via the `create_initial_draft_menu_version` RPC in the same migration.

## Ordering

`carts`, `cart_items`, `cart_item_selections`, `orders`, `order_items`, `order_item_selections`, `order_status_events`.

Ticket #20 (Epic 6) implements the guest cart foundation: `carts`/`cart_items`/`cart_item_selections` (`supabase/migrations/20260803090000_cart_server_side_pricing.sql`) store only line-item _identity_ (dish/variant/option ids, quantity, a display-only name snapshot) -- never a price. Every read/mutation RPC (`get_cart_view`, `add_cart_item`, `update_cart_item_quantity`, `remove_cart_item`) recalculates unit prices, option deltas, and availability from the live `dishes`/`dish_variants`/`options`/`menu_versions` rows at call time and returns a fresh `totalCents` + per-line `isAvailable`/`checkoutReady` signal; this mirrors the pure algorithm unit-tested in `packages/domain/src/cart/pricing.ts`. This is explicitly the foundation `.claude/rules/payments.md` builds on for Epic 7 checkout: "the server always recalculates the complete order total before creating a payment -- a client-submitted total or amount is never trusted" is already true for the cart total today, and the later order-creation step must recalculate again from the same live data rather than trusting the cart's last-read total. Guest identity is an opaque, per-tenant-slug, httpOnly-cookie token (`apps/web/src/lib/cart/token.ts`/`cookie.ts`); only its SHA-256 hash reaches the database, and all cart RPCs are granted to `service_role` only (no `anon` grants), per `docs/security/tenant-isolation.md` Layer 0. Checkout itself (converting a checkout-ready cart into an `orders` row) is out of scope for #20 -- see ticket #21.

Ticket #21 (Epic 6) implements the order state machine and guest checkout on top of #20's cart: `orders`/`order_items`/`order_item_selections`/`order_status_events` (`supabase/migrations/20260804090000_orders_state_machine_and_checkout.sql`), created via the `create_order_from_cart` RPC, which re-verifies the cart belongs to the caller's tenant and re-runs the exact same live price/availability recalculation (`build_cart_view`) the cart already performs, refusing to proceed unless `checkoutReady`. **Order immutability** (see also the cross-cutting rule below): `order_items`/`order_item_selections` copy name/price/variant/extras (plus a placeholder `tax_rate_snapshot`, defaulting to 0 until a future tax-categories ticket populates it -- see `docs/data/domain-model.md` "Tax") at the moment of purchase, and are then enforced immutable at the database level (INSERT-only; UPDATE/DELETE/TRUNCATE rejected for app-facing roles, mirroring `audit_logs`' immutability guard) -- a later edit or archive of the live `dishes`/`dish_variants`/`options` rows never retroactively changes a historical order. Payment-critical/identity columns on `orders` itself (`total_cents`/`currency`/`fulfillment_type`/`guest_access_token_hash`/`cart_id`) are likewise locked against app-facing UPDATE once set (Opus epic-6 batch review finding), while correctable customer-provided details (name/phone/table identifier/note) remain mutable. **State machine**: `awaiting_payment -> received -> accepted -> preparing -> ready -> completed`, with `cancelled` reachable from every non-terminal state up through `preparing` (not from `ready`/`completed`) -- canonically defined as pure, unit-tested logic in `packages/domain/src/orders/state-machine.ts` and mirrored at the database level by `is_valid_order_status_transition()`/the `order_status_events_validate` trigger, this repo's established "two enforcement layers" pattern. `orders.status` is a denormalized "current status" kept in sync exclusively from the append-only, immutable `order_status_events` event trail (event-sourced pattern) via `sync_order_status_from_event()`; direct `orders.status` UPDATEs are rejected for app-facing roles outside that one sanctioned path. Checkout collects only the fields the chosen fulfillment type needs (pickup: name + optional phone; table: name + table identifier) -- `delivery` exists solely as a `fulfillment_type` check-constraint placeholder (explicit non-goal). `create_order_from_cart` locks the cart row (`for update`) and a partial unique index (`orders_one_active_per_cart_idx`) rejects a second non-cancelled order for the same cart, closing a duplicate-order race found in Opus batch review. On success, checkout redirects the guest to `/r/[slug]/orders/[token]` (ticket #22) rather than returning order details inline. Guest order access uses its own single-purpose token (`apps/web/src/lib/orders/token.ts`/`cookie.ts`), distinct from the cart token, per `docs/security/tenant-isolation.md` Layer 0 -- ticket #22 builds the guest-facing order-status page on top of it, additionally verifying the resolved order's tenant slug matches the route. Real payment processing (Epic 7) is explicitly out of scope; checkout creates the `awaiting_payment` state ahead of that step.

## Payments

`payments`, `refunds`, `payment_webhook_events`.

## Analytics

`analytics_events`, `daily_analytics_aggregates`.

Ticket #30 (Epic 9) implements the Analytics-Grunddashboard: revenue today (net of same-day refunds), paid order count, average order value, open orders, and payment failures today, computed live from the tenant's own `orders`/`payments`/`refunds` rows (no third-party product analytics for revenue figures) via the timezone-aware `get_analytics_dashboard_summary()` RPC (`supabase/migrations/20260818090000_analytics_dashboard_summary.sql`), which enforces `analytics.read` itself. `daily_analytics_aggregates` remains an unimplemented, documented target shape for a later ticket if incremental pre-aggregation is ever needed for performance -- today's live-query approach (backed by a `payments (tenant_id, status, created_at)` index) is deliberately simpler and always correct. Admin UI: `apps/web/src/app/account/analytics` (dashboard tiles with honest empty states -- average order value renders as "–", never a fabricated 0, when there is no data yet).

Ticket #31 (Epic 9) implements the Topseller-/Low-Performer-Analyse on top of #30: `get_dish_performance_stats()` (`supabase/migrations/20260818100000_dish_performance_stats.sql`) returns raw per-dish stats (units sold, revenue, views, add-to-cart) for the tenant's currently published, non-archived dishes over a configurable trailing window (default 30 days), also enforcing `analytics.read` itself. Ranking (by quantity and, separately, by revenue) and topseller/low-performer classification are pure, unit-tested TypeScript logic (`packages/domain/src/analytics/dish-performance.ts`, `classifyDishPerformance()`) applied to those raw stats -- mirroring this repo's established "pure domain logic + DB aggregation query" split. A dish is never labeled "Low Performer" without a configurable minimum combined evidence threshold (views + add-to-cart + units sold); below that threshold it is labeled "insufficient data" instead, regardless of how low its sales are. **Known instrumentation gap**: nothing in this codebase yet writes a `dish_view` or `add_to_cart` row into `analytics_events` (ticket #6 only ever shipped the bare skeleton table) -- those two counts are therefore always 0 today, an honest reflection of "no data recorded" rather than a bug; `unitsSold`/`revenueCents` (derived from the already-populated `order_items`) are fully functional today. Admin UI: `apps/web/src/app/account/analytics/dishes` (two ranked tables -- by quantity and by revenue -- each row showing its full evidence basis, gated on `analytics.read`).

Ticket #32 (Epic 9) implements period-vs-prior-period trend comparisons (day/week/month/custom range, each against an equal-length prior period) and extras (paid options) selection-rate/additional-revenue analysis on top of #30, via `get_trend_period_stats()` and `get_extras_performance_stats()` (`supabase/migrations/20260818110000_trend_and_extras_analytics.sql`), both enforcing `analytics.read` themselves and both timezone-DST-correct (Postgres's own IANA-tz-database-backed `date_trunc(... at time zone tz)`). Presentation logic (percent change, and never comparing an incomplete current period against a complete prior period without an explicit caveat) is pure, unit-tested TypeScript (`packages/domain/src/analytics/trend-comparison.ts`). **Explicitly NOT implemented**: removed-ingredient analysis -- there is no data model anywhere in this schema that records a customer's per-order choice to remove an ingredient (`removable_ingredients`, ticket #14, is only a menu-catalog table -- "this dish allows removing ingredient X" -- never a per-order-item fact). Building it would need a new table plus changes to the Epic 6 cart/checkout RPCs, out of this ticket's own declared scope ("Migration & Rollback: Keine neue"). The admin UI (`apps/web/src/app/account/analytics/trends`) says this explicitly rather than showing a fabricated empty table.

## Reviews

`ratings`, `rating_moderation`.

## Integrations

`integration_accounts`, `integration_sync_jobs`, `integration_errors`.

## Audit

`audit_logs` (append-only, tenant-scoped, immutable — no UPDATE/DELETE from application code) and `analytics_events` (Grundgerüst only, no aggregation logic — that's Epic 9). Write-only via `recordAuditEvent()` in `packages/domain/src/audit`, which rejects secret-/payment-shaped metadata before it reaches the table. See `docs/security/threat-model.md`'s audit section and `supabase/migrations/20260801050000_audit_log_and_analytics_events_skeleton.sql`.

## Cross-cutting rules

- **Tenant ownership**: every tenant-scoped table has an explicit `tenant_id` column, even where it could technically be inferred through a join — see `docs/security/tenant-isolation.md`.
- **Money**: integer minor units (cents), never floating point. Every monetary table has an explicit `currency` column.
- **Order immutability**: `order_items`/`order_item_selections` store a purchase-time snapshot (name, price, tax, variant, extras) independent of the live `dishes`/`dish_variants` rows, so later menu edits never rewrite history -- implemented by ticket #21, see the "Ordering" section above and `supabase/migrations/20260804090000_orders_state_machine_and_checkout.sql`.
- **Soft delete over hard delete**: menu entities that participate in historical orders are archived, not deleted, to preserve order integrity.
- **Public data**: the public menu/restaurant-profile read path goes through deliberately scoped public queries — no table is broadly world-readable by default.
