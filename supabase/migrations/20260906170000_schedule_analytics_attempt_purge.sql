-- Issue #164 (Opus review finding on #162): purge_stale_menu_view_attempts()
-- and purge_stale_dish_engagement_attempts() (35-day default) existed but no
-- job ever called them. This migration schedules both daily via Supabase
-- pg_cron (free, in-database; no Worker cron / no extra infrastructure).
--
-- Defensive: a no-op where pg_cron is not available (plain Postgres, some
-- CI/local images), so `supabase db reset`/migration validation never fails
-- because of it. Where it is available the extension is enabled and the two
-- jobs are (re)created idempotently by name.
--
-- Permissions are unchanged and deliberately not widened: both purge
-- functions stay SECURITY DEFINER and executable by service_role only
-- (revoked from public in their own migrations); the cron job runs as the
-- job owner (postgres), never as anon/authenticated.
--
-- Rollback:
--   select cron.unschedule('purge-menu-view-attempts');
--   select cron.unschedule('purge-dish-engagement-attempts');
--
-- Verify (hosted project, SQL Editor):  select jobname, schedule from cron.job;
-- Run history:  select jobname, status, start_time from cron.job_run_details order by start_time desc limit 10;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron not available; analytics attempt purge NOT scheduled (see issue #164)';
    return;
  end if;

  create extension if not exists pg_cron;

  -- Idempotent: drop any previous job of the same name first.
  perform cron.unschedule(jobid) from cron.job
    where jobname in ('purge-menu-view-attempts', 'purge-dish-engagement-attempts');

  perform cron.schedule(
    'purge-menu-view-attempts', '15 3 * * *',
    'select public.purge_stale_menu_view_attempts()'
  );
  perform cron.schedule(
    'purge-dish-engagement-attempts', '25 3 * * *',
    'select public.purge_stale_dish_engagement_attempts()'
  );
exception
  when others then
    -- e.g. insufficient privilege to create the extension: never block migrations.
    raise warning 'could not schedule analytics attempt purge: % (see issue #164)', sqlerrm;
end
$$;
