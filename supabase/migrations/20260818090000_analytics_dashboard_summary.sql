-- ============================================================================
-- Analytics-Grunddashboard (Epic 9, ticket #30)
-- ============================================================================
-- Owner-facing dashboard: revenue today, paid order count, average order
-- value, open orders, payment failures -- computed exclusively from this
-- tenant's own `orders`/`payments`/`refunds` data (explicit non-goal: no
-- third-party product analytics for revenue figures).
--
-- No new tenant-scoped table is introduced (the ticket's "Ggf. neue
-- Aggregat-Tabelle" DB-impact note is explicitly conditional -- "ggf." =
-- "if applicable"). `daily_analytics_aggregates`
-- (docs/data/domain-model.md "Analytics") stays a documented target shape for
-- a later ticket, once/if incremental aggregation is actually needed for
-- performance -- today's live-query approach is simple, always correct (no
-- stale/partially-populated aggregate rows to reconcile), and cheap enough
-- at this data volume given the composite index added below. Revisit if a
-- later ticket's data volume needs it.
--
-- Implemented as a single SECURITY DEFINER RPC
-- (`get_analytics_dashboard_summary`), mirroring this repo's established
-- pattern for cross-table tenant-scoped aggregation (`build_cart_view()`,
-- `ensure_refund_matches_payment_and_within_limit()`): the function itself
-- calls `require_tenant_permission(p_tenant_id, 'analytics.read')` before
-- reading anything, so the ticket's "Berechtigungen: analytics.read
-- erforderlich" acceptance criterion is enforced inside the function body
-- rather than via new broad SELECT policies on `payments`/`orders`/`refunds`
-- gated on analytics.read (which would each need their own careful
-- interaction with the existing `payments.read`-gated policies from the
-- refunds migration) -- two enforcement layers per
-- `.claude/rules/tenant-isolation.md` are still both present: (1) the
-- application code below always calls this RPC through the caller's own
-- RLS-scoped session client, which independently proves the caller is
-- authenticated; (2) `require_tenant_permission` inside the function is the
-- actual authorization check, raising `insufficient_privilege` (survived by
-- Postgres's standard error path, not silently swallowed) for anyone lacking
-- `analytics.read` in this tenant -- a caller can never pass a
-- client-supplied tenant_id belonging to another tenant and read that
-- tenant's figures, since `has_tenant_permission` (which this call resolves
-- through) is always evaluated against the *caller's own* membership, not
-- the tenant_id argument in isolation (see the refunds migration's identical
-- precedent/test coverage for this exact shape of cross-tenant attempt).
--
-- Timezone-aware "today": resolved from `restaurant_profiles.timezone`
-- (defaults to 'Europe/Berlin' both as that table's own column default AND
-- here, since a tenant may not have created a restaurant_profiles row yet --
-- ticket #11's admin UI creates it lazily, it is not auto-provisioned at
-- tenant creation). `date_trunc('day', p_as_of at time zone v_timezone) at
-- time zone v_timezone` correctly handles DST transitions because Postgres's
-- `at time zone` conversion always consults the IANA tz database for the
-- specific instant involved, rather than applying a fixed UTC offset --
-- verified by this migration's own tests around the actual 2026
-- spring-forward (2026-03-29 02:00 CEST) and fall-back (2026-10-25 03:00
-- CEST) transitions in `packages/database/src/analytics-dashboard.integration.test.ts`.
--
-- `p_as_of` (defaults to `now()`) exists purely so tests can pin a
-- deterministic instant instead of depending on the real wall-clock date --
-- application code always calls with the default.
--
-- Revenue accounting (acceptance criteria 1/2): "today" is defined by when
-- the underlying `payments` row was recorded (`payments.created_at`), not by
-- when a refund against it later happens -- a refund's own timestamp can
-- fall on a different day than its payment. `netRevenueTodayCents` is
-- `grossRevenueTodayCents` (sum of `paid` payments created today) minus
-- `refundsTodayCents` (sum of `succeeded` refunds whose *underlying payment*
-- was created today) -- so a same-day paid-then-refunded order nets to zero
-- revenue today regardless of which day the refund itself completes on.
-- Only `succeeded` refunds reduce revenue (`pending`/`unconfirmed` haven't
-- actually moved money back yet; `failed` never did) -- see the refunds
-- migration's status semantics.
--
-- Empty-state honesty (acceptance criterion 3, "keine erfundenen Zahlen"):
-- `avgOrderValueCents` is `null` (never `0`) when there were no paid orders
-- today, so the UI can render a clear "no data yet" empty state instead of a
-- misleading average-of-nothing.
--
-- `openOrdersCount` is a live (not "today-scoped") count of orders staff
-- still need to act on: `received`/`accepted`/`preparing`/`ready`.
-- `awaiting_payment` is deliberately excluded -- it is not yet a real,
-- paid order from the business's perspective -- and `completed`/`cancelled`
-- are terminal.
--
-- `paymentFailuresTodayCount` counts `failed` and `flagged_for_review`
-- payments created today -- `flagged_for_review` (ticket #25: webhook amount
-- mismatch, never yet trusted as paid) is a failure from the owner's point
-- of view just as much as an outright Stripe `failed` status.
--
-- Rollback for local/throwaway DBs:
--   drop function if exists get_analytics_dashboard_summary(uuid, timestamptz);
--   drop index if exists payments_tenant_id_status_created_at_idx;
-- ============================================================================

-- Supports both the "paid payments today" and "failed/flagged payments
-- today" queries below without a sequential scan as the table grows.
create index payments_tenant_id_status_created_at_idx
  on payments (tenant_id, status, created_at);

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
  v_gross_revenue_cents bigint;
  v_paid_orders_count integer;
  v_refunds_cents bigint;
  v_open_orders_count integer;
  v_payment_failures_count integer;
  v_currency text;
begin
  -- Authorization: this function IS the enforcement point (see migration
  -- header) -- raises insufficient_privilege for any caller lacking
  -- analytics.read in p_tenant_id, and for an unauthenticated caller.
  perform public.require_tenant_permission(p_tenant_id, 'analytics.read');

  select rp.timezone into v_timezone
    from public.restaurant_profiles rp
   where rp.tenant_id = p_tenant_id;

  v_timezone := coalesce(v_timezone, 'Europe/Berlin');

  v_day_start := date_trunc('day', p_as_of at time zone v_timezone) at time zone v_timezone;
  v_day_end := v_day_start + interval '1 day';

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
    'paymentFailuresTodayCount', v_payment_failures_count
  );
end;
$$;

comment on function get_analytics_dashboard_summary(uuid, timestamptz) is
  'Ticket #30: tenant-scoped, timezone-aware analytics dashboard summary (revenue today net of same-day refunds, paid order count, average order value, open orders, payment failures today). Enforces analytics.read itself via require_tenant_permission -- see migration header. p_as_of defaults to now(); only tests pass an explicit instant.';

revoke all on function get_analytics_dashboard_summary(uuid, timestamptz) from public;
grant execute on function get_analytics_dashboard_summary(uuid, timestamptz) to authenticated, service_role;
