-- ============================================================================
-- menu_view_attempts retention (PR #129 review finding)
-- ============================================================================
-- `menu_view_attempts` (supabase/migrations/20260905130000_menu_view_rate_limited_analytics.sql,
-- ticket #67) had no cleanup path at all: every call to `record_menu_view()`
-- inserts a row, but nothing ever deleted one. Its dedup window only needs
-- "today" (`view_date`) and its rate-limit window only looks back 10 minutes
-- (`created_at`) -- rows older than a day or two serve no functional purpose
-- and would otherwise grow this table unbounded forever.
--
-- This repo has no cron/scheduled-job infrastructure yet (same constraint
-- already documented for `analytics_events` in
-- docs/security/threat-model.md's retention section) -- rather than wait for
-- one, this adds `purge_stale_menu_view_attempts()`, an on-demand purge RPC
-- mirroring `purge_expired_analytics_events()`'s shape exactly (fixed
-- retention window, SECURITY DEFINER, service_role-only), deliberately kept
-- generous (35 days -- well past both the 1-day dedup window and the
-- 10-minute rate-limit window, so it can never interfere with either) since
-- there is no user-facing "configure this" surface the way
-- `privacy_retention_settings` gives `analytics_events`. Unlike
-- `purge_expired_analytics_events()`, nothing in the app calls this yet --
-- it exists so an operator (or a future scheduled-job ticket, once this
-- platform has one) has a real cleanup path to invoke, closing the "no
-- cleanup path at all" gap even before cron infra exists. Tracked in
-- docs/security/threat-model.md alongside the equivalent analytics_events
-- caveat.
--
-- Rollback: additive-only. A maintainer can run by hand against a
-- local/throwaway DB:
--   revoke all on function purge_stale_menu_view_attempts(integer) from service_role;
--   drop function if exists purge_stale_menu_view_attempts(integer);
-- ============================================================================

create or replace function purge_stale_menu_view_attempts(p_retention_days integer default 35)
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
    delete from public.menu_view_attempts
     where created_at < now() - make_interval(days => p_retention_days)
    returning id
  )
  select count(*) into v_deleted_count from purged;

  return v_deleted_count;
end;
$$;

comment on function purge_stale_menu_view_attempts(integer) is
  'PR #129 review finding: on-demand retention purge for menu_view_attempts (ticket #67), which otherwise has no cleanup path -- deletes rows older than p_retention_days (default 35, generously past both the 1-day dedup window and the 10-minute rate-limit window). Not yet wired to a scheduled job (this platform has none) -- see docs/security/threat-model.md.';

revoke all on function purge_stale_menu_view_attempts(integer) from public;
grant execute on function purge_stale_menu_view_attempts(integer) to service_role;
