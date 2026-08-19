-- ============================================================================
-- Trendvergleiche und Extras-Analytics (Epic 9, ticket #32)
-- ============================================================================
-- Two independent, `analytics.read`-gated SECURITY DEFINER RPCs, mirroring
-- #30's (`get_analytics_dashboard_summary()`) and #31's
-- (`get_dish_performance_stats()`) established pattern exactly (function
-- itself calls `require_tenant_permission()`; no new broad SELECT policies
-- needed on `orders`/`payments`/`refunds`/`order_items`/`order_item_selections`).
-- No new table -- ticket #32's own "Datenbank/Migration" note says "Nutzt
-- bestehende Order-/Analytics-Tabellen".
--
-- ----------------------------------------------------------------------------
-- IMPORTANT SCOPE NOTE (flagged, not silently worked around -- see the PR for
-- this ticket): ticket #32's "Umfang" mentions both "Extras-" AND
-- "Entfernte-Zutaten-Auswertung" (removed-ingredient analysis), but only
-- "Extras-Auswertung zeigt Auswahlrate und zusätzlichen Umsatz korrekt" is an
-- actual, checked acceptance criterion -- removed ingredients are never
-- mentioned there. This migration implements ONLY the extras (paid options)
-- analysis, which the existing `order_item_selections` table (ticket #21,
-- reliably populated by the real checkout flow) fully and honestly supports
-- today.
--
-- Removed-ingredient analysis is NOT implemented here, and deliberately not
-- faked with an always-zero table: unlike ticket #31's `analytics_events`
-- gap (a table exists, nothing writes to it yet), there is NO data model
-- ANYWHERE in this schema that records a customer's per-order choice to
-- remove an ingredient -- `removable_ingredients` (ticket #14) is only a
-- menu-catalog table ("this dish allows removing ingredient X"), never a
-- per-order-item fact. Building that would require a genuinely new
-- migration (a new `order_item_removed_ingredients`-shaped table) AND
-- changes to the Epic 6 cart/checkout RPCs
-- (`build_cart_view()`/`add_cart_item()`/`create_order_from_cart()`) to
-- accept and snapshot such removals in the first place -- a materially
-- larger, cross-epic change that doesn't fit this ticket's own declared
-- scope ("Migration & Rollback: Keine neue", "Nutzt bestehende
-- Order-/Analytics-Tabellen"). Tracked as an explicit, incomplete part of
-- this ticket's "Umfang" (not of its checked acceptance criteria) -- see the
-- PR description and `docs/data/domain-model.md` "Analytics" for the
-- residual-gap note, and the UI's own explicit "not yet available" message
-- rather than a fabricated empty table.
-- ----------------------------------------------------------------------------
--
-- Rollback for local/throwaway DBs:
--   drop function if exists get_extras_performance_stats(uuid, integer);
--   drop function if exists get_trend_period_stats(uuid, text, timestamptz, date, date);
--   drop function if exists compute_period_order_stats(uuid, timestamptz, timestamptz);
-- ============================================================================

-- ----------------------------------------------------------------------------
-- compute_period_order_stats -- internal helper, NOT independently callable
-- by authenticated/service_role (no grant issued below beyond the implicit
-- owner privilege get_trend_period_stats() relies on to call it) -- it does
-- NOT check analytics.read itself, so it must never be reachable except
-- through a caller that already checked it.
-- ----------------------------------------------------------------------------
create or replace function compute_period_order_stats(
  p_tenant_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_gross_revenue_cents bigint;
  v_paid_orders_count integer;
  v_refunds_cents bigint;
begin
  select coalesce(sum(amount_cents), 0), count(*)
    into v_gross_revenue_cents, v_paid_orders_count
    from public.payments
   where tenant_id = p_tenant_id
     and status = 'paid'
     and created_at >= p_start
     and created_at < p_end;

  select coalesce(sum(r.amount_cents), 0)
    into v_refunds_cents
    from public.refunds r
    join public.payments p on p.id = r.payment_id
   where r.tenant_id = p_tenant_id
     and r.status = 'succeeded'
     and p.created_at >= p_start
     and p.created_at < p_end;

  return jsonb_build_object(
    'grossRevenueCents', v_gross_revenue_cents,
    'refundsCents', v_refunds_cents,
    'netRevenueCents', v_gross_revenue_cents - v_refunds_cents,
    'paidOrdersCount', v_paid_orders_count
  );
end;
$$;

comment on function compute_period_order_stats(uuid, timestamptz, timestamptz) is
  'Internal helper for get_trend_period_stats() -- computes gross/net revenue (net of succeeded refunds against same-window payments) and paid order count for an arbitrary [p_start, p_end) window. Deliberately NOT granted to authenticated/service_role -- it does not check analytics.read itself.';

revoke all on function compute_period_order_stats(uuid, timestamptz, timestamptz) from public;

-- ----------------------------------------------------------------------------
-- get_trend_period_stats -- timezone-aware period-vs-prior-period comparison.
-- Period boundaries are computed with Postgres's own IANA-tz-database-backed
-- `date_trunc(...)`, but the actual period-length arithmetic (+1 day/+7
-- days/+1 month, and the equivalent subtraction for the previous period) is
-- ALWAYS done on the naive local timestamp (`date_trunc('day'/'week'/'month',
-- p_as_of at time zone tz)`, a `timestamp without time zone`) and only
-- converted back to an instant via `at time zone tz` afterwards -- never by
-- adding/subtracting an interval to/from an already-resolved `timestamptz`.
-- The latter would silently resolve in the session TimeZone (UTC) and
-- produce always-exactly-24h/168h/730h windows that are wrong across a DST
-- transition (a "day" is 23h or 25h in local time on the transition day
-- itself). Verified across the actual 2026 Europe/Berlin DST transitions
-- (spring-forward 2026-03-29, fall-back 2026-10-25) in this migration's own
-- integration tests
-- (`packages/database/src/trend-and-extras-analytics.integration.test.ts`).
-- `date_trunc('week', ...)` is ISO 8601 (Monday-start) in Postgres, matching
-- this app's Europe/Berlin default.
--
-- Each returned period carries `isComplete`: whether p_as_of is at or past
-- that period's own end -- the actual completeness signal ticket #32's
-- acceptance criterion 1 needs. This function deliberately does NOT decide
-- how to *present* an incomplete-vs-complete comparison (e.g. a caveat
-- message) -- that's pure, unit-tested TypeScript
-- (`packages/domain/src/analytics/trend-comparison.ts`,
-- `compareTrendPeriods()`), mirroring #31's "pure domain logic + DB
-- aggregation query" split.
-- ----------------------------------------------------------------------------
create or replace function get_trend_period_stats(
  p_tenant_id uuid,
  p_period_type text,
  p_as_of timestamptz default now(),
  p_custom_start date default null,
  p_custom_end date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_timezone text;
  v_currency text;
  v_current_start timestamptz;
  v_current_end timestamptz;
  v_previous_start timestamptz;
  v_previous_end timestamptz;
  v_local_as_of timestamp;
  v_previous_days integer;
begin
  perform public.require_tenant_permission(p_tenant_id, 'analytics.read');

  if p_period_type not in ('day', 'week', 'month', 'custom') then
    raise exception 'p_period_type must be one of ''day'', ''week'', ''month'', ''custom'' (got: %)', p_period_type
      using errcode = 'invalid_parameter_value';
  end if;

  select rp.timezone into v_timezone
    from public.restaurant_profiles rp
   where rp.tenant_id = p_tenant_id;

  v_timezone := coalesce(v_timezone, 'Europe/Berlin');

  select currency into v_currency
    from public.payments
   where tenant_id = p_tenant_id
   order by created_at desc
   limit 1;

  v_currency := coalesce(v_currency, 'EUR');

  v_local_as_of := p_as_of at time zone v_timezone;

  if p_period_type = 'day' then
    v_current_start := date_trunc('day', v_local_as_of) at time zone v_timezone;
    v_current_end := (date_trunc('day', v_local_as_of) + interval '1 day') at time zone v_timezone;
    v_previous_end := v_current_start;
    v_previous_start := (date_trunc('day', v_local_as_of) - interval '1 day') at time zone v_timezone;
  elsif p_period_type = 'week' then
    v_current_start := date_trunc('week', v_local_as_of) at time zone v_timezone;
    v_current_end := (date_trunc('week', v_local_as_of) + interval '7 days') at time zone v_timezone;
    v_previous_end := v_current_start;
    v_previous_start := (date_trunc('week', v_local_as_of) - interval '7 days') at time zone v_timezone;
  elsif p_period_type = 'month' then
    v_current_start := date_trunc('month', v_local_as_of) at time zone v_timezone;
    v_current_end := (date_trunc('month', v_local_as_of) + interval '1 month')
      at time zone v_timezone;
    v_previous_end := v_current_start;
    v_previous_start := (date_trunc('month', v_local_as_of) - interval '1 month')
      at time zone v_timezone;
  else
    -- custom: an explicit [p_custom_start, p_custom_end) date range (end
    -- exclusive -- e.g. a UI "from 2026-08-01 to 2026-08-14 inclusive" picker
    -- passes p_custom_end = 2026-08-15), compared against the immediately
    -- preceding period of the SAME length (ticket #32: "freier Zeitraum vs.
    -- gleich langer Vorzeitraum"). The previous window is derived via whole-
    -- day arithmetic on the local calendar DATEs (p_custom_start/p_custom_end
    -- are `date`, so subtraction yields an integer day count), never via a
    -- timestamptz difference -- a timestamptz difference across a DST
    -- transition is a day-time interval that, when subtracted back from an
    -- instant, lands on a non-midnight local clock time.
    if p_custom_start is null or p_custom_end is null or p_custom_end <= p_custom_start then
      raise exception 'p_custom_start and p_custom_end are required for period_type=''custom'', and p_custom_end must be after p_custom_start'
        using errcode = 'invalid_parameter_value';
    end if;

    v_previous_days := p_custom_end - p_custom_start;

    v_current_start := p_custom_start::timestamp at time zone v_timezone;
    v_current_end := p_custom_end::timestamp at time zone v_timezone;
    v_previous_end := v_current_start;
    v_previous_start := (p_custom_start - v_previous_days)::timestamp at time zone v_timezone;
  end if;

  return jsonb_build_object(
    'timezone', v_timezone,
    'currency', v_currency,
    'periodType', p_period_type,
    'asOf', p_as_of,
    'currentPeriod', public.compute_period_order_stats(p_tenant_id, v_current_start, v_current_end)
      || jsonb_build_object(
           'start', v_current_start,
           'end', v_current_end,
           'isComplete', p_as_of >= v_current_end
         ),
    'previousPeriod', public.compute_period_order_stats(p_tenant_id, v_previous_start, v_previous_end)
      || jsonb_build_object(
           'start', v_previous_start,
           'end', v_previous_end,
           'isComplete', p_as_of >= v_previous_end
         )
  );
end;
$$;

comment on function get_trend_period_stats(uuid, text, timestamptz, date, date) is
  'Ticket #32: timezone-aware period-vs-prior-period revenue/order comparison (day/week/month/custom). Enforces analytics.read itself via require_tenant_permission. Each period carries isComplete (p_as_of at/past that period''s own end) -- presentation of an incomplete-vs-complete comparison is decided by packages/domain/src/analytics/trend-comparison.ts''s compareTrendPeriods(), not here. Returns currency (most recent payment''s currency, defaulting to EUR) so callers never hardcode a currency label.';

revoke all on function get_trend_period_stats(uuid, text, timestamptz, date, date) from public;
grant execute on function get_trend_period_stats(uuid, text, timestamptz, date, date) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- get_extras_performance_stats -- selection rate + additional revenue per
-- option (extra), scoped to the tenant's currently published, non-archived
-- dishes (same "current menu" scoping principle as #31's
-- get_dish_performance_stats()).
--
-- eligibleOrderItemCount and selectionCount are BOTH computed against the
-- exact same universe -- order_items (within the window/status filter)
-- whose dish is CURRENTLY assigned this option's option_group -- so
-- selectionCount is always <= eligibleOrderItemCount by construction, and
-- selectionRate (computed in TypeScript, not here -- see
-- trend-comparison.ts's sibling module) can never exceed 100%. This is a
-- documented simplification: an option's dish assignment can change over
-- time, and a past order's dish may no longer currently offer the option it
-- was selected on (or vice versa) -- there is no "was this option actually
-- presented to this guest" log (that would need real event instrumentation,
-- the same #6/#31 analytics_events gap), so "currently assigned" is the best
-- available proxy for "eligible", not a perfect historical reconstruction.
--
-- eligibleOrderItemCount/selectionCount are deliberately COUNTED PER ORDER
-- ITEM (one row of `order_items`), NOT per unit of quantity --
-- `order_item_selections` stores exactly one row per (order_item, option)
-- regardless of that order item's `quantity` (see
-- `20260804090000_orders_state_machine_and_checkout.sql`), i.e. a guest
-- picks "extra cheese" once for the whole line, not once per pizza in it.
-- additionalRevenueCents, in contrast, MUST be quantity-weighted
-- (`price_delta_cents_snapshot * oi.quantity`) to match actual checkout
-- pricing (`(unitPriceCents + selectionsTotalCents) * quantity`, see
-- `packages/domain/src/cart/pricing.ts`) -- an extra selected once on a
-- quantity-3 line item generated 3x that extra's price delta in real
-- revenue. selectionRate itself therefore answers "on what fraction of
-- order-item lines was this extra chosen", not "what fraction of individual
-- units carried it" -- the UI's "Auswahlen / Gelegenheiten" column reflects
-- that (order-item counts), while its adjacent revenue column is
-- quantity-weighted money.
-- ----------------------------------------------------------------------------
create or replace function get_extras_performance_stats(
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

  if v_menu_version_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(stats order by stats ->> 'optionName'), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'optionId', o.id,
               'optionName', o.name,
               'optionGroupId', o.option_group_id,
               'priceDeltaCents', o.price_delta_cents,
               'eligibleOrderItemCount', coalesce(eligible.eligible_count, 0),
               'selectionCount', coalesce(selected.selection_count, 0),
               'additionalRevenueCents', coalesce(selected.revenue_cents, 0)
             ) as stats
        from public.options o
        left join lateral (
          select count(distinct oi.id)::int as eligible_count
            from public.order_items oi
            join public.orders ord on ord.id = oi.order_id
            join public.dishes d on d.id = oi.dish_id
           where oi.tenant_id = p_tenant_id
             and d.tenant_id = p_tenant_id
             and d.menu_version_id = v_menu_version_id
             and d.archived_at is null
             and exists (
               select 1
                 from public.dish_option_group_assignments doga
                where doga.dish_id = d.id
                  and doga.option_group_id = o.option_group_id
             )
             and ord.status not in ('awaiting_payment', 'cancelled')
             and ord.created_at >= v_window_start
        ) eligible on true
        left join lateral (
          select count(*)::int as selection_count,
                 sum(ois.price_delta_cents_snapshot * oi.quantity)::bigint as revenue_cents
            from public.order_item_selections ois
            join public.order_items oi on oi.id = ois.order_item_id
            join public.orders ord on ord.id = oi.order_id
            join public.dishes d on d.id = oi.dish_id
           where ois.option_id = o.id
             and oi.tenant_id = p_tenant_id
             and d.tenant_id = p_tenant_id
             and d.menu_version_id = v_menu_version_id
             and d.archived_at is null
             and exists (
               select 1
                 from public.dish_option_group_assignments doga
                where doga.dish_id = d.id
                  and doga.option_group_id = o.option_group_id
             )
             and ord.status not in ('awaiting_payment', 'cancelled')
             and ord.created_at >= v_window_start
        ) selected on true
       where o.tenant_id = p_tenant_id
         and exists (
           select 1
             from public.dish_option_group_assignments doga
             join public.dishes d on d.id = doga.dish_id
            where doga.option_group_id = o.option_group_id
              and d.tenant_id = p_tenant_id
              and d.menu_version_id = v_menu_version_id
              and d.archived_at is null
         )
    ) t;

  return v_result;
end;
$$;

comment on function get_extras_performance_stats(uuid, integer) is
  'Ticket #32: per-option (extra) selection count/eligible-order-item count/additional revenue, scoped to dishes currently assigned that option''s group in the tenant''s currently published menu, over the last p_days_back days (default 30). Enforces analytics.read itself via require_tenant_permission. Selection rate itself is computed in packages/domain/src/analytics/trend-comparison.ts (selectionRateOf()), not here -- mirrors get_dish_performance_stats()/classifyDishPerformance()''s split. Removed-ingredient analysis is explicitly NOT implemented -- see this migration''s header.';

revoke all on function get_extras_performance_stats(uuid, integer) from public;
grant execute on function get_extras_performance_stats(uuid, integer) to authenticated, service_role;
