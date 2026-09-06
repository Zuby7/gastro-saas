-- ============================================================================
-- Batched dish_view recording + dish_engagement_attempts retention (PR #136 review findings)
-- ============================================================================
-- Two fixes against
-- supabase/migrations/20260906091000_dish_view_and_add_to_cart_analytics.sql
-- (ticket #120 part B), found in Opus review of PR #136:
--
-- 1. `apps/web/src/app/r/[slug]/page.tsx` previously called
--    `record_dish_view()` once PER DISH via `Promise.all`, each call taking
--    its own `pg_advisory_xact_lock` -- for N dishes shown on one page
--    render, that's N round trips and N locks *serialized* on the same
--    (tenant_id, ip_hash) key (the lock is per key, not per call), directly
--    blocking TTFB on the SEO-critical public menu page and making the
--    problem in finding 2 below worse (many single-dish calls each
--    incrementing the shared rate-limit counter, instead of one call
--    checking it once).
--
--    `record_dish_views(p_tenant_id, p_dish_ids uuid[], p_session_token_hash,
--    p_ip_hash)` fixes this: ONE advisory lock, ONE rate-limit count check,
--    and ONE bulk `insert ... on conflict do nothing` for the whole page
--    render's dish ids, mirroring `record_dish_view()`'s per-dish logic
--    exactly but amortized across the batch. Dish ids not belonging to
--    `p_tenant_id` are silently filtered out (same fail-closed,
--    defense-in-depth posture as `record_dish_view()`) rather than aborting
--    the whole batch. If the remaining rate-limit budget is smaller than the
--    batch, only that many dish ids (arbitrary which, since the budget is a
--    hard cap either way) are recorded -- this preserves the same "never
--    exceed dish_view_ip_rate_limit_max attempts in the trailing window"
--    guarantee `record_dish_view()` has, just checked once per batch instead
--    of once per dish. Returns the count of `dish_view` events actually
--    recorded (not a boolean -- a batch call has a partial-success
--    dimension a single-dish call doesn't).
--
--    `record_dish_view()` itself is left in place, unchanged in behavior --
--    it's still a reasonable primitive for a future single-dish call site
--    (e.g. a dedicated dish-detail page), and the existing integration
--    tests for it keep covering that single-dish path directly. Only the
--    app's public-menu-page call site (`apps/web/src/app/r/[slug]/page.tsx`)
--    switches to the new batched RPC.
--
-- 2. `dish_engagement_attempts` had no retention/purge path at all -- the
--    same gap already found and fixed for `menu_view_attempts` via
--    supabase/migrations/20260906080000_menu_view_attempts_retention.sql
--    (PR #129 review). `purge_stale_dish_engagement_attempts()` mirrors
--    `purge_stale_menu_view_attempts()` exactly: fixed default retention (35
--    days, well past both the 1-day dedup window and the 10-minute
--    rate-limit window), SECURITY DEFINER, service_role-only, on-demand (no
--    scheduled-job infra yet -- see docs/security/threat-model.md).
--
-- Rollback: additive-only. A maintainer can run by hand against a
-- local/throwaway DB:
--   revoke all on function record_dish_views(uuid, uuid[], text, text) from service_role;
--   drop function if exists record_dish_views(uuid, uuid[], text, text);
--   revoke all on function purge_stale_dish_engagement_attempts(integer) from service_role;
--   drop function if exists purge_stale_dish_engagement_attempts(integer);
-- ============================================================================

-- ----------------------------------------------------------------------------
-- record_dish_views: batched version of record_dish_view, one lock/check/insert per page render
-- ----------------------------------------------------------------------------
create or replace function record_dish_views(
  p_tenant_id uuid,
  p_dish_ids uuid[],
  p_session_token_hash text,
  p_ip_hash text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Same fixed threshold as record_dish_view() -- see that function's
  -- comment for why 200/10min is sized for a realistic menu render, and why
  -- this batching doesn't raise the threshold itself.
  dish_view_ip_rate_limit_max constant integer := 200;
  dish_view_ip_rate_limit_window constant interval := interval '10 minutes';
  v_today date := (now() at time zone 'utc')::date;
  v_ip_window_count integer;
  v_remaining integer;
  v_valid_dish_ids uuid[];
  v_recorded_count integer := 0;
begin
  if p_tenant_id is null or p_dish_ids is null or p_session_token_hash is null or p_ip_hash is null then
    return 0;
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    return 0;
  end if;

  -- ONE advisory lock for the entire batch (not one per dish) -- this is
  -- the fix for the serialized-per-dish locking finding.
  perform pg_advisory_xact_lock(
    hashtextextended('dish_view:' || p_tenant_id::text || ':' || p_ip_hash, 0)
  );

  -- ONE rate-limit count check for the entire batch.
  select count(*)
    into v_ip_window_count
    from public.dish_engagement_attempts
   where tenant_id = p_tenant_id
     and event_type = 'dish_view'
     and ip_hash = p_ip_hash
     and created_at >= now() - dish_view_ip_rate_limit_window;

  v_remaining := dish_view_ip_rate_limit_max - v_ip_window_count;
  if v_remaining <= 0 then
    -- Rate-limited: reject the whole batch outright, write nothing.
    return 0;
  end if;

  -- Only dish ids that actually belong to p_tenant_id (defense-in-depth,
  -- same as record_dish_view()), deduplicated, capped to whatever budget
  -- remains -- never inserts more than dish_view_ip_rate_limit_max total
  -- attempts in the trailing window, same guarantee as the single-dish
  -- function, just enforced once per batch instead of once per dish.
  select array_agg(valid_dish_id) into v_valid_dish_ids
  from (
    select distinct dish_id as valid_dish_id
    from unnest(p_dish_ids) as dish_id
    where exists (
      select 1 from public.dishes where id = dish_id and tenant_id = p_tenant_id
    )
    limit v_remaining
  ) as valid_dish_ids;

  if v_valid_dish_ids is null then
    return 0;
  end if;

  -- ONE bulk insert for the entire batch.
  with inserted as (
    insert into public.dish_engagement_attempts
      (tenant_id, dish_id, event_type, session_token_hash, ip_hash, view_date)
    select p_tenant_id, dish_id, 'dish_view', p_session_token_hash, p_ip_hash, v_today
    from unnest(v_valid_dish_ids) as dish_id
    on conflict (tenant_id, dish_id, event_type, session_token_hash, view_date) do nothing
    returning dish_id
  ),
  events as (
    insert into public.analytics_events (tenant_id, event_type, dish_id)
    select p_tenant_id, 'dish_view', dish_id from inserted
    returning 1
  )
  select count(*) into v_recorded_count from events;

  return v_recorded_count;
end;
$$;

comment on function record_dish_views(uuid, uuid[], text, text) is
  'PR #136 review finding: batched version of record_dish_view() -- one advisory lock, one rate-limit count check, and one bulk insert for an entire page render''s dish ids, instead of one of each per dish. Returns the number of dish_view events actually recorded (0 if rate-limited, tenant unresolved, or every dish id was already deduped/invalid for this tenant today). p_tenant_id must already be resolved server-side from the public route slug; p_dish_ids are independently re-verified against p_tenant_id. Only service_role may call this.';

revoke all on function record_dish_views(uuid, uuid[], text, text) from public;
grant execute on function record_dish_views(uuid, uuid[], text, text) to service_role;

-- ----------------------------------------------------------------------------
-- purge_stale_dish_engagement_attempts: retention purge, mirrors purge_stale_menu_view_attempts()
-- ----------------------------------------------------------------------------
create or replace function purge_stale_dish_engagement_attempts(p_retention_days integer default 35)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted_count integer;
begin
  if p_retention_days is null or p_retention_days < 1 then
    p_retention_days := 35;
  end if;

  with purged as (
    delete from public.dish_engagement_attempts
     where created_at < now() - make_interval(days => p_retention_days)
    returning id
  )
  select count(*) into v_deleted_count from purged;

  return v_deleted_count;
end;
$$;

comment on function purge_stale_dish_engagement_attempts(integer) is
  'PR #136 review finding: on-demand retention purge for dish_engagement_attempts (ticket #120 part B), which otherwise had no cleanup path -- deletes rows older than p_retention_days (default 35, generously past both the 1-day dedup window and the 10-minute rate-limit window). Mirrors purge_stale_menu_view_attempts() (PR #129 review). Not yet wired to a scheduled job (this platform has none) -- see docs/security/threat-model.md.';

revoke all on function purge_stale_dish_engagement_attempts(integer) from public;
grant execute on function purge_stale_dish_engagement_attempts(integer) to service_role;
