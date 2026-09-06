-- ============================================================================
-- Awaiting-payment timeout sweep (issue #88, risk:payment)
-- ============================================================================
-- `.claude/rules/payments.md` rule 14 requires an order left in
-- `awaiting_payment` past a configurable timeout (default 30 minutes) to be
-- automatically cancelled, so it stops inflating "open orders" dashboards and
-- stops blocking availability. No Epic 7 ticket built this (a known,
-- documented gap -- see docs/decisions/assumptions.md's "Missing server-side
-- awaiting_payment timeout" note) -- made worse by checkout creating the
-- order (create_order_from_cart(), 20260804090000) BEFORE the Stripe checkout
-- session (20260808140000_checkout_payments_stripe_checkout_session.sql), so
-- a failed session-creation call can leave an order stuck in
-- `awaiting_payment` forever with no payment ever attempted.
--
-- sweep_stale_awaiting_payment_orders(p_timeout_minutes) -- the actual fix.
-- System-level, tenant-agnostic by design (sweeps every tenant in one pass):
-- this is an internal maintenance job, not a tenant-facing action, so unlike
-- transition_order_status() (ticket #28) it takes no p_tenant_id and does not
-- call require_tenant_permission() -- there is no authenticated session to
-- check permissions against when a cron job/scheduled trigger calls it.
-- Reuses the EXISTING order_status_events write path exactly like
-- create_order_from_cart() does (an awaiting_payment -> cancelled row,
-- validated by validate_order_status_event()'s existing trigger and synced to
-- orders.status by sync_order_status_from_event()'s existing trigger) --
-- no new write path is invented. `actor_user_id` is left null (system-caused,
-- same convention as the guest-driven creation event), with a `note`
-- identifying this as the automated sweep for traceability in the audit
-- trail.
--
-- Idempotent/safe to call repeatedly: only orders still in `awaiting_payment`
-- older than the cutoff match; once cancelled they no longer match on a
-- re-run. `for update skip locked` avoids blocking on (or being blocked by) a
-- concurrent staff/webhook transition of the same order -- that order is
-- simply picked up on the next sweep if it's still stale then.
--
-- Configurable timeout (ticket's own "default 30 minutes" framing): a plain
-- function parameter defaulting to 30, not a new settings table/UI -- this
-- ticket's stated scope is the sweep itself, not a tenant-configurable
-- settings screen (no ticket asks for one; a single, ops-adjustable default
-- is exactly what "configurable timeout (default: 30 minutes)" in the rule
-- requires). Ops can pass a different value directly (e.g. adjust the
-- scheduled `cron.schedule` call below) without a migration if ever needed.
--
-- Scheduling mechanism -- checked, not assumed (per this ticket's explicit
-- instruction): this repo has NO existing scheduled-job infrastructure
-- (`supabase/config.toml` configures no pg_cron section, no
-- `supabase/functions/` directory exists yet, and grep across
-- `supabase/migrations/` finds zero `create extension`/`pg_cron`/`cron.`
-- usage anywhere before this migration -- confirmed by direct inspection,
-- not assumed). Two real options existed:
--   1. Supabase's `pg_cron` Postgres extension, scheduled from directly
--      inside a migration (`cron.schedule(...)`) -- no new external service,
--      no new secret, works identically on local/preview/staging/production
--      since it lives entirely in Postgres.
--   2. A scheduled GitHub Actions workflow (mirrors this repo's existing
--      free-tier backup job precedent, docs/operations/deployment-strategy.md
--      "Backups") hitting a PostgREST RPC endpoint on a deployed Supabase
--      project.
-- Chosen: (1), pg_cron. It is bundled in Supabase's own Postgres image (both
-- hosted and the local CLI's -- Supabase's documented "Scheduling Jobs"
-- guide enables it with nothing beyond `create extension pg_cron;`, no
-- postgresql.conf edits), needs no new secret/external service (unlike (2),
-- which would additionally need a deployed Supabase project's URL +
-- service-role key as new GitHub Actions secrets that do not exist yet in
-- this repo -- there is no deployed staging/production Supabase project or
-- CI secret for one at the time of this ticket), and keeps the whole fix
-- inside this one migration, consistent with "reuse what's actually
-- available" rather than standing up a new external trigger for this alone.
--
-- HONESTY NOTE (residual concern, read before merging): this sandbox has no
-- running Docker daemon, so `supabase start` could not be executed locally to
-- literally confirm `create extension pg_cron` succeeds against the real
-- local Postgres image before opening this PR. The repo's own
-- `.github/workflows/migration-check.yml` job runs a REAL `supabase start`
-- (actual Docker, actual Supabase Postgres image) on every PR and is the
-- actual verification for this -- treat that CI run, not this note, as the
-- authoritative check. If `create extension pg_cron` unexpectedly fails
-- there, the fallback is option (2) above (a scheduled GitHub Actions
-- workflow calling `sweep_stale_awaiting_payment_orders()` via PostgREST) once
-- a deployed project + secret exist -- the RPC itself is written to be
-- callable either way, so no rework of the sweep logic itself would be
-- needed, only the scheduling wrapper.
--
-- Rollback for local/throwaway DBs:
--   select cron.unschedule('sweep-stale-awaiting-payment-orders');
--   revoke all on function sweep_stale_awaiting_payment_orders(integer) from authenticated, service_role;
--   drop function if exists sweep_stale_awaiting_payment_orders(integer);
--   drop extension if exists pg_cron;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- sweep_stale_awaiting_payment_orders -- system-level maintenance RPC.
-- ----------------------------------------------------------------------------
create or replace function sweep_stale_awaiting_payment_orders(p_timeout_minutes integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_order record;
  v_cancelled_count integer := 0;
begin
  if p_timeout_minutes is null or p_timeout_minutes <= 0 then
    raise exception 'p_timeout_minutes must be a positive integer' using errcode = 'invalid_parameter_value';
  end if;

  v_cutoff := now() - (p_timeout_minutes::text || ' minutes')::interval;

  -- `for update skip locked`: locks each candidate row like
  -- transition_order_status()'s own `for update` does, but skips (rather than
  -- waits on) any order a concurrent staff action/webhook is already
  -- transitioning -- that order is simply reconsidered on the next sweep if
  -- it's still `awaiting_payment` and still stale then.
  for v_order in
    select id, tenant_id
      from public.orders
     where status = 'awaiting_payment'
       and created_at < v_cutoff
     order by created_at
     for update skip locked
  loop
    -- Re-uses the existing order_status_events write path (exactly like
    -- create_order_from_cart()'s own initial-event insert) -- no new write
    -- path. validate_order_status_event()'s existing trigger both confirms
    -- 'awaiting_payment' -> 'cancelled' is a valid transition and that
    -- from_status truthfully matches the order's current status;
    -- sync_order_status_from_event()'s existing trigger then keeps
    -- orders.status in sync.
    insert into public.order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id, note)
    values (
      v_order.tenant_id,
      v_order.id,
      'awaiting_payment',
      'cancelled',
      null,
      format(
        'Automatisch storniert: Zahlungsfrist von %s Minuten ueberschritten (Issue #88, awaiting-payment timeout sweep).',
        p_timeout_minutes
      )
    );

    v_cancelled_count := v_cancelled_count + 1;
  end loop;

  return v_cancelled_count;
end;
$$;

comment on function sweep_stale_awaiting_payment_orders(integer) is
  'Issue #88: cancels every order still `awaiting_payment` older than p_timeout_minutes (default 30) across ALL tenants (system-level maintenance job, not tenant-scoped) via the existing order_status_events write path. Idempotent/safe to call repeatedly. Scheduled every 5 minutes by pg_cron below.';

revoke all on function sweep_stale_awaiting_payment_orders(integer) from public;
-- service_role only -- this is a system-level maintenance action, not
-- something an authenticated tenant member calls directly (there is no
-- tenant-scoped permission that would even make sense to gate a
-- cross-tenant sweep on). The pg_cron job below runs as the migration's own
-- (superuser) role, which bypasses function EXECUTE grants entirely, same as
-- every other privileged/non-app-facing precedent in this codebase (e.g.
-- reject_order_history_mutation()'s "non-app-facing caller" exemption) --
-- this grant exists purely so a future ops/service-role-authenticated manual
-- trigger (e.g. an admin "run sweep now" action) remains possible without a
-- further migration.
grant execute on function sweep_stale_awaiting_payment_orders(integer) to service_role;

-- ----------------------------------------------------------------------------
-- Scheduling: pg_cron, every 5 minutes, default 30-minute timeout.
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;

-- cron.schedule(job_name, ...) upserts by job_name (pg_cron >= 1.4) -- safe to
-- re-run this migration (e.g. `supabase db reset`) without creating
-- duplicate scheduled jobs.
select cron.schedule(
  'sweep-stale-awaiting-payment-orders',
  '*/5 * * * *',
  $$select public.sweep_stale_awaiting_payment_orders(30);$$
);
