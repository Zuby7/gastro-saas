-- ============================================================================
-- Manuelle Nacherfassung von Verkäufen (Epic 9 follow-up, ticket #58)
-- ============================================================================
-- Restaurants sell outside this platform's own order/payment system
-- (Lieferando, walk-in without the ordering system). This ticket lets an
-- authorized staff member log those sales manually, from a dish's admin
-- page, so analytics/reporting can reflect them.
--
-- Structural separation (ticket's own non-negotiable): manual entries live in
-- a BRAND NEW table, `manual_sales_entries`. Nothing in this migration (or
-- the application code built on top of it) ever inserts a row into
-- `orders`/`order_items`/`payments`, and nothing in those tables' own
-- read/write paths is touched here -- see
-- packages/database/src/manual-sales-entries.integration.test.ts's dedicated
-- "never touches orders/order_items/payments" assertion. A manual entry is
-- never confused with a real, paid order: it carries no order_id/payment_id,
-- no fulfillment/status state machine, and no relationship whatsoever to
-- Stripe/webhooks.
--
-- Columns, minimal per the ticket's own scope ("Anzahl, Datum, optional
-- Kanal/Quelle"): dish_id, quantity, sale_date, optional free-text channel
-- (e.g. "Lieferando"/"Vor Ort"), entered_by_user_id (who logged it, for
-- accountability -- never trusted as an authorization input, purely
-- descriptive), created_at. Deliberately no order-shaped columns (no status,
-- no payment reference, no price snapshot) -- this is not a payment record
-- and must never be mistaken for one. Analytics functions below derive an
-- ESTIMATED revenue figure from the dish's CURRENT price_cents at query time
-- (clearly labeled "estimated" in both the RPC output and the UI) rather than
-- persisting a price snapshot here, since a manual entry is explicitly not a
-- priced transaction the business actually settled through this platform.
--
-- Permission: a new, narrow `analytics.manual_sales.write`, rather than
-- reusing `menu.write` (this is sales/analytics data entry, not menu
-- content editing -- a Marketing-role user with only `analytics.read` should
-- not automatically gain menu-editing rights just to log a sale, and a
-- Manager who edits the menu is not necessarily who should be trusted to
-- correct sales figures) and rather than reusing `analytics.read` (a
-- read-only permission must never also authorize a write). Granted by
-- default to Owner (via the existing wildcard-all-permissions grant) and
-- Manager -- mirrors `payments.refund`'s scope (a sensitive figures-affecting
-- action, not given to Kitchen/Service/Marketing by default). A tenant can
-- still grant it to a custom role via the existing roles.manage UI.
--
-- Two enforcement layers per `.claude/rules/tenant-isolation.md`:
--   1. RLS on `manual_sales_entries` (`apply_basic_tenant_policies`, same
--      helper as every other tenant-scoped admin table) -- SELECT open to any
--      tenant member (matches this repo's convention for dish/menu-adjacent
--      tables; not itself highly sensitive financial data), INSERT/UPDATE/
--      DELETE gated on `analytics.manual_sales.write`.
--   2. The server action inserting a row (`recordManualSaleAction`) calls
--      `requireTenantPermission` itself before writing, exactly like every
--      other dish-admin mutation in this codebase.
--
-- Analytics integration ("diese nachgetragenen Verkäufe fließen in die
-- Analytics ein"): both `get_analytics_dashboard_summary()` (#30) and
-- `get_dish_performance_stats()` (#31) are extended with ADDITIONAL,
-- clearly-labeled fields (`manualSales*`) -- the existing real-order-derived
-- fields (`netRevenueTodayCents`, `unitsSold`, `revenueCents`, etc.) are
-- completely unchanged bit-for-bit, so a caller reading only the old fields
-- sees exactly the same, unmixed "real orders" numbers as before this
-- ticket. The UI (dashboard + dish-performance pages) renders the manual
-- figures in a visually separate, explicitly labeled section/column, never
-- merged into a single blended total.
--
-- Rollback for local/throwaway DBs:
--   drop policy if exists manual_sales_entries_select_member on manual_sales_entries;
--   drop policy if exists manual_sales_entries_insert_write on manual_sales_entries;
--   drop policy if exists manual_sales_entries_update_write on manual_sales_entries;
--   drop policy if exists manual_sales_entries_delete_write on manual_sales_entries;
--   drop table if exists manual_sales_entries;
--   -- then re-apply the previous bodies of get_analytics_dashboard_summary/
--   -- get_dish_performance_stats from their own migrations, and the previous
--   -- body of seed_standard_roles_for_tenant from
--   -- 20260819110000_privacy_export_retention_and_deletion_requests.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Permission
-- ----------------------------------------------------------------------------
insert into permissions (key, description)
values
  ('analytics.manual_sales.write', 'Log manual sales entries for external/offline channels')
on conflict (key) do update set description = excluded.description;

-- Backfill for tenants that already exist at migration-apply time (mirrors
-- every prior permission-introducing migration's own pattern).
insert into role_permissions (role_id, permission_key)
select r.id, 'analytics.manual_sales.write' from roles r where r.key = 'owner'
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, 'analytics.manual_sales.write' from roles r where r.key = 'manager'
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- seed_standard_roles_for_tenant(): reconstructed from the actual latest
-- accumulated body (20260819110000_privacy_export_retention_and_deletion_requests.sql),
-- plus this ticket's `analytics.manual_sales.write` grant for Manager. Owner
-- keeps getting every permission via the unchanged wildcard subquery below.
-- ----------------------------------------------------------------------------
create or replace function seed_standard_roles_for_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_role_id uuid;
  v_manager_role_id uuid;
  v_kitchen_role_id uuid;
  v_service_role_id uuid;
  v_marketing_role_id uuid;
begin
  insert into public.roles (tenant_id, key, name, description, is_system)
  values
    (new.id, 'owner', 'Owner', 'Full tenant administration and safety-critical permissions.', true),
    (new.id, 'manager', 'Manager', 'Operational tenant management without role-template administration.', true),
    (new.id, 'kitchen', 'Kitchen', 'Kitchen workflow access only.', true),
    (new.id, 'service', 'Service', 'Service and order workflow access.', true),
    (new.id, 'marketing', 'Marketing', 'Menu publishing and analytics access without payment authority.', true)
  on conflict (tenant_id, key) do update
     set name = excluded.name,
         description = excluded.description,
         is_system = true;

  select id into v_owner_role_id from public.roles where tenant_id = new.id and key = 'owner';
  select id into v_manager_role_id from public.roles where tenant_id = new.id and key = 'manager';
  select id into v_kitchen_role_id from public.roles where tenant_id = new.id and key = 'kitchen';
  select id into v_service_role_id from public.roles where tenant_id = new.id and key = 'service';
  select id into v_marketing_role_id from public.roles where tenant_id = new.id and key = 'marketing';

  insert into public.role_permissions (role_id, permission_key)
  select v_owner_role_id, key from public.permissions
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission_key)
  values
    (v_manager_role_id, 'users.invite'),
    (v_manager_role_id, 'users.manage'),
    (v_manager_role_id, 'menu.publish'),
    (v_manager_role_id, 'menu.read'),
    (v_manager_role_id, 'menu.availability.manage'),
    (v_manager_role_id, 'orders.cancel'),
    (v_manager_role_id, 'orders.read'),
    (v_manager_role_id, 'orders.manage'),
    (v_manager_role_id, 'payments.refund'),
    (v_manager_role_id, 'payments.read'),
    (v_manager_role_id, 'analytics.read'),
    (v_manager_role_id, 'analytics.manual_sales.write'),
    (v_manager_role_id, 'audit.read'),
    (v_manager_role_id, 'reviews.read'),
    (v_manager_role_id, 'reviews.moderate'),
    (v_kitchen_role_id, 'menu.read'),
    (v_kitchen_role_id, 'menu.availability.manage'),
    (v_kitchen_role_id, 'orders.cancel'),
    (v_kitchen_role_id, 'orders.read'),
    (v_kitchen_role_id, 'orders.manage'),
    (v_service_role_id, 'menu.read'),
    (v_service_role_id, 'menu.availability.manage'),
    (v_service_role_id, 'orders.cancel'),
    (v_service_role_id, 'orders.read'),
    (v_service_role_id, 'orders.manage'),
    (v_marketing_role_id, 'menu.publish'),
    (v_marketing_role_id, 'menu.read'),
    (v_marketing_role_id, 'analytics.read')
  on conflict do nothing;

  return new;
end;
$$;

comment on function seed_standard_roles_for_tenant() is
  'Creates the Owner/Manager/Kitchen/Service/Marketing system roles for a tenant and attaches their default permissions.';

-- ----------------------------------------------------------------------------
-- manual_sales_entries table
-- ----------------------------------------------------------------------------
create table manual_sales_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  dish_id uuid not null references dishes (id) on delete cascade,
  quantity integer not null check (quantity > 0),
  sale_date date not null,
  channel text check (channel is null or char_length(channel) <= 100),
  entered_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table manual_sales_entries is
  'Ticket #58: manually logged sales that happened OUTSIDE this platform''s own order/payment system (e.g. Lieferando, walk-in without the ordering system). Structurally separate from orders/order_items/payments -- never written to or read from those tables. Feeds analytics additively via dedicated manualSales* fields, never blended into the real-order figures.';

-- One dish's manual entries are looked up together (dish page listing,
-- analytics aggregation both filter on tenant_id + dish_id; the dashboard
-- summary additionally filters on sale_date).
create index manual_sales_entries_tenant_dish_idx on manual_sales_entries (tenant_id, dish_id);
create index manual_sales_entries_tenant_sale_date_idx on manual_sales_entries (tenant_id, sale_date);

alter table manual_sales_entries enable row level security;
grant select, insert, update, delete on manual_sales_entries to authenticated;
grant all on manual_sales_entries to service_role;

select apply_basic_tenant_policies('manual_sales_entries', 'analytics.manual_sales.write');

-- ----------------------------------------------------------------------------
-- get_analytics_dashboard_summary(): additive manual-sales fields
-- ----------------------------------------------------------------------------
-- Function body otherwise unchanged from
-- 20260818090000_analytics_dashboard_summary.sql -- only the two new
-- `v_manual_*` computations and their two new jsonb keys are added.
create or replace function get_analytics_dashboard_summary(
  p_tenant_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_timezone text;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_local_date date;
  v_gross_revenue_cents bigint;
  v_paid_orders_count integer;
  v_refunds_cents bigint;
  v_open_orders_count integer;
  v_payment_failures_count integer;
  v_currency text;
  v_manual_sales_units integer;
  v_manual_sales_estimated_revenue_cents bigint;
begin
  -- Authorization: this function IS the enforcement point (see migration
  -- header) -- raises insufficient_privilege for any caller lacking
  -- analytics.read in p_tenant_id, and for an unauthenticated caller.
  perform public.require_tenant_permission(p_tenant_id, 'analytics.read');

  select rp.timezone into v_timezone
    from public.restaurant_profiles rp
   where rp.tenant_id = p_tenant_id;

  v_timezone := coalesce(v_timezone, 'Europe/Berlin');

  -- Calendar-day arithmetic must happen on the LOCAL (timezone-naive) wall
  -- clock timestamp before converting back to timestamptz. Adding
  -- `interval '1 day'` directly to a timestamptz instead resolves in the
  -- *session* TimeZone (UTC on Supabase) and is therefore always exactly
  -- 24h -- wrong on DST-transition days, which are 23h (spring-forward) or
  -- 25h (fall-back) in local wall-clock time.
  v_day_start := date_trunc('day', p_as_of at time zone v_timezone) at time zone v_timezone;
  v_day_end := (date_trunc('day', p_as_of at time zone v_timezone) + interval '1 day') at time zone v_timezone;
  v_local_date := date_trunc('day', p_as_of at time zone v_timezone)::date;

  select coalesce(sum(amount_cents), 0), count(*)
    into v_gross_revenue_cents, v_paid_orders_count
    from public.payments
   where tenant_id = p_tenant_id
     and status = 'paid'
     and created_at >= v_day_start
     and created_at < v_day_end;

  select coalesce(sum(r.amount_cents), 0)
    into v_refunds_cents
    from public.refunds r
    join public.payments p on p.id = r.payment_id
   where r.tenant_id = p_tenant_id
     and r.status = 'succeeded'
     and p.created_at >= v_day_start
     and p.created_at < v_day_end;

  select count(*)
    into v_open_orders_count
    from public.orders
   where tenant_id = p_tenant_id
     and status in ('received', 'accepted', 'preparing', 'ready');

  select count(*)
    into v_payment_failures_count
    from public.payments
   where tenant_id = p_tenant_id
     and status in ('failed', 'flagged_for_review')
     and created_at >= v_day_start
     and created_at < v_day_end;

  select currency into v_currency
    from public.payments
   where tenant_id = p_tenant_id
   order by created_at desc
   limit 1;

  v_currency := coalesce(v_currency, 'EUR');

  -- Manual sales entries (ticket #58): "today" for a manual entry means its
  -- own `sale_date` (a plain, timezone-naive calendar date the staff member
  -- entered) equals the tenant's local calendar date for p_as_of -- entirely
  -- separate from the payments-derived figures above, never summed into
  -- them. Revenue here is an ESTIMATE (current dish price_cents * quantity,
  -- a dish with no fixed price contributes 0 -- honestly, not fabricated),
  -- since a manual entry never went through real checkout pricing.
  select coalesce(sum(mse.quantity), 0),
         coalesce(sum(mse.quantity * coalesce(d.price_cents, 0)), 0)
    into v_manual_sales_units, v_manual_sales_estimated_revenue_cents
    from public.manual_sales_entries mse
    join public.dishes d on d.id = mse.dish_id
   where mse.tenant_id = p_tenant_id
     and mse.sale_date = v_local_date;

  return jsonb_build_object(
    'timezone', v_timezone,
    'dayStart', v_day_start,
    'dayEnd', v_day_end,
    'currency', v_currency,
    'grossRevenueTodayCents', v_gross_revenue_cents,
    'refundsTodayCents', v_refunds_cents,
    'netRevenueTodayCents', v_gross_revenue_cents - v_refunds_cents,
    'paidOrdersTodayCount', v_paid_orders_count,
    'avgOrderValueCents',
      case when v_paid_orders_count > 0
        then round(v_gross_revenue_cents::numeric / v_paid_orders_count)
        else null
      end,
    'openOrdersCount', v_open_orders_count,
    'paymentFailuresTodayCount', v_payment_failures_count,
    'manualSalesTodayUnits', v_manual_sales_units,
    'manualSalesTodayEstimatedRevenueCents', v_manual_sales_estimated_revenue_cents
  );
end;
$$;

comment on function get_analytics_dashboard_summary(uuid, timestamptz) is
  'Ticket #30 (+ #58 manual sales additions): tenant-scoped, timezone-aware analytics dashboard summary (revenue today net of same-day refunds, paid order count, average order value, open orders, payment failures, manual sales today). Enforces analytics.read itself via require_tenant_permission -- see migration header. manualSalesTodayUnits/manualSalesTodayEstimatedRevenueCents are ADDITIVE, clearly-labeled, and never folded into netRevenueTodayCents/grossRevenueTodayCents -- those two fields are computed exclusively from real payments, unchanged from ticket #30. p_as_of defaults to now(); only tests pass an explicit instant.';

revoke all on function get_analytics_dashboard_summary(uuid, timestamptz) from public;
grant execute on function get_analytics_dashboard_summary(uuid, timestamptz) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- get_dish_performance_stats(): additive manual-sales fields
-- ----------------------------------------------------------------------------
create or replace function get_dish_performance_stats(
  p_tenant_id uuid,
  p_days_back integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_menu_version_id uuid;
  v_window_start timestamptz;
  v_result jsonb;
begin
  -- Authorization: this function IS the enforcement point (see migration
  -- header) -- raises insufficient_privilege for any caller lacking
  -- analytics.read in p_tenant_id, and for an unauthenticated caller.
  perform public.require_tenant_permission(p_tenant_id, 'analytics.read');

  if p_days_back is null or p_days_back <= 0 then
    raise exception 'p_days_back must be a positive integer' using errcode = 'invalid_parameter_value';
  end if;

  v_window_start := now() - make_interval(days => p_days_back);

  select mv.id into v_menu_version_id
    from public.menu_versions mv
   where mv.tenant_id = p_tenant_id
     and mv.status = 'published'
   order by mv.published_at desc nulls last
   limit 1;

  -- No published menu at all: an honest empty list, not a fabricated one.
  if v_menu_version_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(stats order by stats ->> 'dishName'), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'dishId', d.id,
               'dishName', d.name,
               'categoryId', d.category_id,
               'priceCents', d.price_cents,
               'currency', d.currency,
               'unitsSold', coalesce(sales.units_sold, 0),
               'revenueCents', coalesce(sales.revenue_cents, 0),
               'viewsCount', coalesce(views.views_count, 0),
               'addToCartCount', coalesce(cart_adds.add_to_cart_count, 0),
               -- Ticket #58: manual (external-channel/walk-in) sales for this
               -- dish over the same p_days_back window, ADDITIVE and kept in
               -- separate keys -- never summed into unitsSold/revenueCents
               -- above, which stay exclusively derived from real,
               -- non-cancelled order_items as before this ticket.
               'manualUnitsSold', coalesce(manual_sales.manual_units_sold, 0),
               'manualEstimatedRevenueCents', coalesce(manual_sales.manual_revenue_cents, 0)
             ) as stats
        from public.dishes d
        left join lateral (
          select sum(oi.quantity)::int as units_sold,
                 -- Revenue includes both the base price (unit_price_cents_snapshot,
                 -- multiplied by quantity) AND each order item's selected
                 -- paid options/extras (order_item_selections.price_delta_cents_snapshot,
                 -- also multiplied by quantity -- an extra applies per unit
                 -- of the dish ordered). Without the selections contribution
                 -- this figure would silently under-count revenue and not
                 -- reconcile with the payments-derived dashboard total (#30).
                 sum(
                   oi.quantity * oi.unit_price_cents_snapshot
                   + oi.quantity * coalesce(sel.selections_total, 0)
                 )::bigint as revenue_cents
            from public.order_items oi
            join public.orders o on o.id = oi.order_id
            left join lateral (
              select sum(ois.price_delta_cents_snapshot)::bigint as selections_total
                from public.order_item_selections ois
               where ois.order_item_id = oi.id
                 and ois.tenant_id = p_tenant_id
            ) sel on true
           where oi.dish_id = d.id
             and oi.tenant_id = p_tenant_id
             -- Only orders that actually moved past the payment step count
             -- as a real "sale" -- an order still awaiting_payment (or
             -- cancelled before payment) never happened from the business's
             -- perspective.
             and o.status not in ('awaiting_payment', 'cancelled')
             and o.created_at >= v_window_start
        ) sales on true
        left join lateral (
          select count(*)::int as views_count
            from public.analytics_events ae
           where ae.dish_id = d.id
             and ae.tenant_id = p_tenant_id
             and ae.event_type = 'dish_view'
             and ae.created_at >= v_window_start
        ) views on true
        left join lateral (
          select count(*)::int as add_to_cart_count
            from public.analytics_events ae
           where ae.dish_id = d.id
             and ae.tenant_id = p_tenant_id
             and ae.event_type = 'add_to_cart'
             and ae.created_at >= v_window_start
        ) cart_adds on true
        left join lateral (
          select sum(mse.quantity)::int as manual_units_sold,
                 sum(mse.quantity * coalesce(d.price_cents, 0))::bigint as manual_revenue_cents
            from public.manual_sales_entries mse
           where mse.dish_id = d.id
             and mse.tenant_id = p_tenant_id
             and mse.sale_date >= v_window_start::date
        ) manual_sales on true
       where d.tenant_id = p_tenant_id
         and d.menu_version_id = v_menu_version_id
         and d.archived_at is null
    ) t;

  return v_result;
end;
$$;

comment on function get_dish_performance_stats(uuid, integer) is
  'Ticket #31 (+ #58 manual sales additions): raw per-dish stats (units sold, revenue, views, add-to-cart, manual units/estimated revenue) for a tenant''s currently published, non-archived dishes over the last p_days_back days (default 30). Enforces analytics.read itself via require_tenant_permission -- see migration header. manualUnitsSold/manualEstimatedRevenueCents are ADDITIVE and never folded into unitsSold/revenueCents, which stay exclusively derived from real order_items as before this ticket. Ranking/topseller/low-performer classification (packages/domain/src/analytics/dish-performance.ts) deliberately only ever uses the real-order fields, never the manual ones, so a tenant cannot inflate a dish''s topseller ranking via manual entries.';

revoke all on function get_dish_performance_stats(uuid, integer) from public;
grant execute on function get_dish_performance_stats(uuid, integer) to authenticated, service_role;
