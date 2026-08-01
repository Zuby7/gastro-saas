-- ============================================================================
-- Ticket #7 fix cycle 1 (Opus CHANGES_REQUESTED, artifacts/reviews/issue-7.json)
-- ============================================================================
-- Three independent fixes, all requiring new/changed database surface:
--
-- 1. Atomic rate-limit reserve-and-count (was: separate SELECT count then
--    separate INSERT, a check-then-act race where concurrent requests could
--    all observe a stale "under the limit" count before any of them
--    recorded an attempt).
--
--    `reserve_auth_rate_limit_attempt(p_scope, p_ip, p_email, p_window_seconds)`
--    records one attempt AND returns the in-window failed-attempt counts for
--    both the `ip`-only bucket and the `(ip, email)` bucket, in one
--    round-trip. A `pg_advisory_xact_lock` keyed on `(scope, ip)` serializes
--    concurrent callers sharing that key for the duration of this single
--    statement's implicit transaction (released automatically at
--    commit/rollback) -- without it, two callers hitting this function at
--    the same instant could still both insert their own row and then both
--    count the other's not-yet-committed row as absent, defeating the
--    "atomic" guarantee even inside one SQL statement. Locking on
--    `(scope, ip)` (not `(scope, ip, email)`) is deliberately the coarser
--    key, since the ip-only bucket must also be race-free and is a superset
--    condition of the ip+email bucket.
--
--    Only `succeeded = false` rows count (see fix #2 below); the row this
--    call inserts always starts as `succeeded = false` and is only flipped
--    afterwards by `mark_auth_rate_limit_attempt_succeeded` once the guarded
--    operation (sign-in) is known to have actually succeeded.
--
-- 2. Rate-limit availability fix: successful attempts no longer count
--    toward the limit (`succeeded = false` filter above), and the counted
--    key is `(ip, email)`, never `email` alone -- see `rate-limit.ts`'s
--    header comment for the full rationale (email-alone keying let any
--    anonymous third party lock a known victim's email out of login by
--    spraying failed attempts, optionally from many source IPs).
--
-- 3. Least-privilege login-audit path (was: apps/web's `audit-client.ts`
--    used a raw `pg` Pool over `SUPABASE_DB_URL` -- the Postgres
--    **superuser** connection string -- directly from the web app's request
--    path, bypassing RLS entirely to read `auth.users`/`tenant_memberships`
--    and write `audit_logs`).
--
--    `record_failed_login_audit_event(p_email)` does the same
--    email -> tenant_membership -> audit_logs work as a `SECURITY DEFINER`
--    RPC, callable via the already-present service-role Supabase JS client
--    (the same one the rate limiter above uses) instead of a direct
--    superuser Postgres connection. `apps/web`'s raw `pg` Pool
--    (`lib/audit/audit-client.ts`) is removed in this fix cycle now that
--    nothing in the request path needs it.
--
-- Both RPCs are revoked from `public`/`anon`/`authenticated` and granted
-- only to `service_role` -- these are trusted server-side-only operations,
-- never meant to be callable directly by a logged-in user via PostgREST.
--
-- Rollback: additive-only versus the previous migration. Down-migration a
-- maintainer can run by hand against a local/throwaway DB:
--   drop function if exists record_failed_login_audit_event(text);
--   drop function if exists mark_auth_rate_limit_attempt_succeeded(uuid);
--   drop function if exists reserve_auth_rate_limit_attempt(text, text, text, integer);
-- ============================================================================

-- ----------------------------------------------------------------------------
-- reserve_auth_rate_limit_attempt: atomic reserve + in-window failure counts
-- ----------------------------------------------------------------------------
create or replace function reserve_auth_rate_limit_attempt(
  p_scope text,
  p_ip text,
  p_email text,
  p_window_seconds integer
)
returns table (attempt_id uuid, ip_count integer, ip_email_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_since timestamptz := now() - (p_window_seconds || ' seconds')::interval;
  v_ip_count integer;
  v_ip_email_count integer;
begin
  -- Serializes concurrent callers for the same (scope, ip) so the
  -- count-and-insert below can never race across sessions -- see the
  -- migration header's "atomic rate-limit reserve-and-count" note.
  perform pg_advisory_xact_lock(hashtextextended('auth_rate_limit:' || p_scope || ':' || p_ip, 0));

  insert into public.auth_rate_limit_attempts (scope, ip, email, succeeded)
  values (p_scope, p_ip, p_email, false)
  returning id into v_attempt_id;

  select count(*)
    into v_ip_count
    from public.auth_rate_limit_attempts
   where scope = p_scope
     and ip = p_ip
     and succeeded = false
     and attempted_at >= v_since;

  select count(*)
    into v_ip_email_count
    from public.auth_rate_limit_attempts
   where scope = p_scope
     and ip = p_ip
     and email = p_email
     and succeeded = false
     and attempted_at >= v_since;

  return query select v_attempt_id, v_ip_count, v_ip_email_count;
end;
$$;

comment on function reserve_auth_rate_limit_attempt(text, text, text, integer) is
  'Ticket #7 fix cycle 1: atomically records one auth attempt and returns in-window failed-attempt counts for the (scope, ip) and (scope, ip, email) buckets, serialized per (scope, ip) via pg_advisory_xact_lock. Only service_role may call this -- see apps/web/src/lib/auth/supabase-rate-limit-store.ts.';

revoke all on function reserve_auth_rate_limit_attempt(text, text, text, integer) from public;
grant execute on function reserve_auth_rate_limit_attempt(text, text, text, integer) to service_role;

-- ----------------------------------------------------------------------------
-- mark_auth_rate_limit_attempt_succeeded: exclude a succeeded attempt from future counts
-- ----------------------------------------------------------------------------
create or replace function mark_auth_rate_limit_attempt_succeeded(p_attempt_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.auth_rate_limit_attempts
     set succeeded = true
   where id = p_attempt_id;
$$;

comment on function mark_auth_rate_limit_attempt_succeeded(uuid) is
  'Ticket #7 fix cycle 1: flips a previously reserved auth_rate_limit_attempts row to succeeded = true so it is excluded from future failure counts (a legitimate user must never be locked out by their own successful logins). Only service_role may call this.';

revoke all on function mark_auth_rate_limit_attempt_succeeded(uuid) from public;
grant execute on function mark_auth_rate_limit_attempt_succeeded(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- record_failed_login_audit_event: least-privilege replacement for the raw pg Pool path
-- ----------------------------------------------------------------------------
create or replace function record_failed_login_audit_event(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_user_id uuid;
begin
  select tm.tenant_id, u.id
    into v_tenant_id, v_user_id
    from auth.users u
    join public.tenant_memberships tm on tm.user_id = u.id
   where u.email = p_email
   limit 1;

  -- No tenant membership resolves for this email (unknown account, or a
  -- Supabase Auth user with no tenant yet): nothing to attribute an
  -- audit_logs row to (that table's tenant_id is NOT NULL by design -- see
  -- supabase/migrations/20260801050000_audit_log_and_analytics_events_skeleton.sql).
  -- Still captured for brute-force detection via auth_rate_limit_attempts
  -- regardless of whether the email resolves to anything; just not written
  -- to the tenant-scoped audit_logs table. Same accepted tradeoff as the
  -- previous implementation (see the ticket #7 PR's original login-audit.ts).
  if v_user_id is null then
    return;
  end if;

  insert into public.audit_logs (tenant_id, actor_user_id, action, target_type, target_id)
  values (v_tenant_id, v_user_id, 'auth.login.failed', 'user', v_user_id::text);
end;
$$;

comment on function record_failed_login_audit_event(text) is
  'Ticket #7 fix cycle 1: SECURITY DEFINER replacement for the previous raw pg Pool (SUPABASE_DB_URL superuser connection) path -- resolves the tenant membership for a failed login''s email and appends one audit_logs row, callable via the service-role Supabase JS client instead of a direct superuser Postgres connection from the web app''s request path. Only service_role may call this.';

revoke all on function record_failed_login_audit_event(text) from public;
grant execute on function record_failed_login_audit_event(text) to service_role;
