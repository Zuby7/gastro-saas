-- ============================================================================
-- Topseller-/Low-Performer-Analyse (Epic 9, ticket #31): raw per-dish stats
-- ============================================================================
-- Ticket #31's own "Datenbank/Migration" note says "Nutzt analytics_events"
-- (no new table) -- this migration adds exactly one new query function,
-- `get_dish_performance_stats()`, that returns RAW per-dish aggregates
-- (units sold, revenue, views, add-to-cart) for the tenant's currently
-- published menu. It deliberately does NOT decide "topseller"/"low
-- performer" itself -- that ranking/minimum-sample-size classification is
-- pure, unit-tested TypeScript logic
-- (`packages/domain/src/analytics/dish-performance.ts`,
-- `classifyDishPerformance()`), mirroring this repo's established "pure
-- domain logic + DB aggregation query" split (`packages/domain/src/cart/pricing.ts`
-- + `build_cart_view()`; `packages/domain/src/orders/state-machine.ts` +
-- `is_valid_order_status_transition()`).
--
-- IMPORTANT KNOWN GAP (flagged, not silently worked around): as of this
-- migration, NOTHING in this codebase ever writes a `dish_view` or
-- `add_to_cart` row into `analytics_events` -- ticket #6's migration only
-- ever shipped the bare skeleton table, and no menu-browsing/cart ticket has
-- added event-tracking instrumentation since. `viewsCount`/`addToCartCount`
-- below will therefore always be 0 today, which is an HONEST reflection of
-- "no data has ever been recorded" (never a fabricated number), not a bug in
-- this query -- but it does mean the "Beleg-Zahlen (Views/Add-to-Cart)" part
-- of this ticket's UI can't show anything but zero until a follow-up ticket
-- adds that instrumentation (see the analogous instrumentation gap called
-- out in the PR for this ticket). `unitsSold`/`revenueCents` are fully
-- functional today: they're derived from `order_items`, which IS reliably
-- populated by the existing checkout flow (ticket #21), and are this
-- ticket's actually-usable ranking signal in the meantime.
--
-- Scope: only the tenant's CURRENTLY PUBLISHED menu version's non-archived
-- dishes are considered -- ranking dishes that no longer exist on the live
-- menu (deleted/archived drafts, superseded versions) would answer a
-- different, not-currently-actionable question ("how did an old menu
-- perform") that this ticket's business intent ("which of MY CURRENT dishes
-- are doing well/poorly") doesn't ask for. `order_items.dish_id` is a plain,
-- non-enforced-immutable reference (see the orders migration's own comment)
-- that can go null once an old dish is hard-deleted -- this query only ever
-- joins into currently-live dishes, so that's a non-issue here.
--
-- Authorization: mirrors `get_analytics_dashboard_summary()`'s (#30) own
-- pattern exactly -- this function itself calls
-- `require_tenant_permission(p_tenant_id, 'analytics.read')` before reading
-- anything, rather than adding new broad SELECT policies on
-- `dishes`/`order_items`/`orders`/`analytics_events` gated on analytics.read
-- (each of which would need its own careful interaction with those tables'
-- existing RLS policies). SECURITY DEFINER, `search_path = ''`.
--
-- Rollback for local/throwaway DBs:
--   drop function if exists get_dish_performance_stats(uuid, integer);
-- ============================================================================

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
               'addToCartCount', coalesce(cart_adds.add_to_cart_count, 0)
             ) as stats
        from public.dishes d
        left join lateral (
          select sum(oi.quantity)::int as units_sold,
                 sum(oi.quantity * oi.unit_price_cents_snapshot)::bigint as revenue_cents
            from public.order_items oi
            join public.orders o on o.id = oi.order_id
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
       where d.tenant_id = p_tenant_id
         and d.menu_version_id = v_menu_version_id
         and d.archived_at is null
    ) t;

  return v_result;
end;
$$;

comment on function get_dish_performance_stats(uuid, integer) is
  'Ticket #31: raw per-dish stats (units sold, revenue, views, add-to-cart) for a tenant''s currently published, non-archived dishes over the last p_days_back days (default 30). Enforces analytics.read itself via require_tenant_permission -- see migration header. Ranking/topseller/low-performer classification is deliberately NOT done here -- see packages/domain/src/analytics/dish-performance.ts''s classifyDishPerformance().';

revoke all on function get_dish_performance_stats(uuid, integer) from public;
grant execute on function get_dish_performance_stats(uuid, integer) to authenticated, service_role;
