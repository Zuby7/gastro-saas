-- ============================================================================
-- Audit log entry for purge_expired_analytics_events() (ticket #123)
-- ============================================================================
-- Found during the Opus review verification cycle for ticket #36 (PR #122,
-- APPROVED): the "Jetzt bereinigen" button
-- (`purgeExpiredAnalyticsEventsAction` -> `purge_expired_analytics_events()`,
-- supabase/migrations/20260819110000_privacy_export_retention_and_deletion_requests.sql)
-- deleted expired `analytics_events` rows but wrote no `audit_logs` entry --
-- unlike `export_tenant_data()`'s caller (which the app layer separately
-- audits) and `process_tenant_data_deletion_request()`, which both record an
-- audit trail for their own tenant-data-affecting actions.
--
-- This migration replaces `purge_expired_analytics_events()` with a version
-- that additionally writes one `audit_logs` row per call, recording the
-- actor (`auth.uid()`), tenant, and the number of rows actually deleted --
-- mirroring `process_tenant_data_deletion_request()`'s
-- `'privacy.deletion_request.completed'` audit entry shape exactly (same
-- `target_type`/`target_id` convention, a `metadata` jsonb payload with the
-- purge count).
--
-- Deliberately still writes the audit entry even when `v_deleted_count` is
-- 0 (nothing was actually expired yet) -- an audit trail proving "someone
-- with tenant.settings.write invoked the purge" is the point, independent
-- of whether it had anything to do; matching `process_tenant_data_deletion_request()`,
-- which likewise always writes its completion entry regardless of counts.
--
-- Rollback: restores the previous (ticket #36) function body -- a
-- maintainer can re-apply
-- supabase/migrations/20260819110000_privacy_export_retention_and_deletion_requests.sql's
-- `create or replace function purge_expired_analytics_events(uuid)` body by
-- hand against a local/throwaway DB.
-- ============================================================================

create or replace function purge_expired_analytics_events(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retention_days integer;
  v_deleted_count integer;
  v_actor_user_id uuid := auth.uid();
begin
  perform public.require_tenant_permission(p_tenant_id, 'tenant.settings.write');

  select analytics_events_retention_days into v_retention_days
    from public.privacy_retention_settings
   where tenant_id = p_tenant_id;

  v_retention_days := coalesce(v_retention_days, 365);

  with purged as (
    delete from public.analytics_events
     where tenant_id = p_tenant_id
       and created_at < now() - make_interval(days => v_retention_days)
    returning id
  )
  select count(*) into v_deleted_count from purged;

  insert into public.audit_logs (tenant_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id,
    v_actor_user_id,
    'privacy.analytics_events.purged',
    'tenant',
    p_tenant_id::text,
    jsonb_build_object(
      'deletedCount', v_deleted_count,
      'retentionDays', v_retention_days
    )
  );

  return v_deleted_count;
end;
$$;

comment on function purge_expired_analytics_events(uuid) is
  'Ticket #36 / #123: deletes analytics_events rows older than the tenant''s configured (or default 365-day) retention period, and records an audit_logs entry (actor, tenant, deleted count, retention window) -- mirroring process_tenant_data_deletion_request()''s audit trail. Gated on tenant.settings.write, independently re-checked here on top of the caller''s own requireTenantPermission call.';

revoke all on function purge_expired_analytics_events(uuid) from public;
grant execute on function purge_expired_analytics_events(uuid) to authenticated, service_role;
