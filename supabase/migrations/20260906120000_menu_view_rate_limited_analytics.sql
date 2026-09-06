-- ============================================================================
-- Rate-limited/deduplicated menu_viewed analytics (ticket #67)
-- ============================================================================
-- Follow-up to the immediate fix in
-- supabase/migrations/20260801120000_public_menu_queries.sql, which removed
-- an unbounded `analytics_events` insert from `get_public_menu()` outright
-- (Opus batch review, epic-3-5-batch, "anonymous write amplification" --
-- `get_public_menu()` is granted to `anon`, and was writing one
-- `analytics_events` row on *every* call with no gate at all, letting anyone
-- inflate "menu viewed" counts arbitrarily just by hitting the public
-- endpoint in a loop).
--
-- This migration introduces a real, gated path for `menu_viewed` events,
-- deliberately kept OUT of `get_public_menu()` itself (a read-heavy function
-- with no natural once-per-visit boundary -- prefetches, retries, and
-- pagination could all call it many times per real visit). Instead:
--
-- `record_menu_view(p_tenant_id, p_session_token_hash, p_ip_hash)`:
--   - Never trusts a client-supplied tenant_id: the app layer resolves
--     tenant_id server-side from the public route slug before calling this
--     (mirrors `resolveTenantIdBySlug`/`resolveGuestCartContext` in
--     apps/web/src/lib/cart/service.ts, docs/security/tenant-isolation.md
--     Layer 0) -- this function only ever receives an already-resolved uuid,
--     never a slug or any other client-controlled identifier.
--   - Dedup: `menu_view_attempts` has a UNIQUE (tenant_id, session_token_hash,
--     view_date) constraint. `INSERT ... ON CONFLICT DO NOTHING` means at
--     most one row (and therefore at most one `analytics_events` row) is
--     ever recorded per tenant+session+calendar day (UTC), no matter how
--     many times this function is called for that combination.
--   - Rate limiting: an advisory xact lock keyed on (tenant_id, ip_hash),
--     same pattern as `reserve_auth_rate_limit_attempt`'s
--     pg_advisory_xact_lock keyed on (scope, ip) (see
--     supabase/migrations/20260801070000_auth_rate_limit_atomic_and_login_audit_rpc.sql),
--     serializes concurrent callers sharing that key so the count-then-insert
--     below can't race. If a single (tenant_id, ip_hash) pair has already
--     recorded MENU_VIEW_IP_RATE_LIMIT_MAX attempts within the trailing
--     MENU_VIEW_IP_RATE_LIMIT_WINDOW, further calls are rejected outright
--     (no row written at all, real or deduped) -- this is what bounds
--     unbounded row growth even from an attacker who rotates a fresh session
--     token on every request specifically to defeat the per-session dedup.
--     Both thresholds are fixed constants inside the function body (not
--     caller-supplied parameters) since this function is only ever invoked
--     by trusted server-side code (service_role) -- no caller should be able
--     to widen its own rate limit.
--   - Only inserts `analytics_events` (event_type = 'menu_viewed') on the
--     first-seen-today dedup insert; every other call (deduped or
--     rate-limited) returns false and writes nothing to analytics_events.
--     The rate-limited case additionally `raise log`s server-side (tenant_id,
--     ip_hash, window_count) so it's distinguishable from an ordinary dedup
--     in Postgres logs, even though the boolean return value alone can't
--     tell the two apart (PR #129 Opus finding).
--
-- Distinguishing real vs. synthetic/test events: `analytics_events` already
-- has no `anon` grant (see 20260801050000's header) and this new RPC is
-- likewise never granted to `anon`/`authenticated` -- only `service_role`.
-- Combined, an anonymous browser request has no path to write a
-- `menu_viewed` row except through this exact rate-limited/deduplicated
-- function, called from trusted server-side code (never from the browser
-- directly). Direct `INSERT INTO analytics_events` (available to
-- `authenticated`/`service_role` per the table's existing grants) remains
-- the established path for synthetic/seed/test data throughout this
-- codebase (see e.g. packages/database/src/dish-performance-stats.integration.test.ts)
-- and is never mistaken for a real view, since real `menu_viewed` rows only
-- ever originate from this RPC.
--
-- Rollback: additive-only versus the previous migration. Down-migration a
-- maintainer can run by hand against a local/throwaway DB:
--   drop function if exists record_menu_view(uuid, text, text);
--   drop table if exists menu_view_attempts;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- menu_view_attempts
-- ----------------------------------------------------------------------------
create table menu_view_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- SHA-256 hex digest of an opaque, ephemeral, anonymous per-browser session
  -- token (apps/web/src/lib/menu-view/token.ts) -- the raw token lives only
  -- in an httpOnly cookie, never in the database, mirroring the guest cart
  -- token convention (apps/web/src/lib/cart/token.ts).
  session_token_hash text not null check (char_length(session_token_hash) > 0),
  -- SHA-256 hex digest of the resolved client IP (apps/web/src/lib/auth/client-ip.ts)
  -- -- hashed rather than stored raw since this table's only purpose is
  -- rate-limit bucketing, not IP logging.
  ip_hash text not null check (char_length(ip_hash) > 0),
  -- UTC calendar day this attempt falls into -- the dedup window ("1 event
  -- per tenant+session+day") is anchored to this column, not `created_at`,
  -- so the UNIQUE constraint below can enforce it directly via ON CONFLICT.
  view_date date not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, session_token_hash, view_date)
);

comment on table menu_view_attempts is
  'Ticket #67: backs record_menu_view()''s rate-limiting (per tenant_id+ip_hash, trailing window) and dedup (UNIQUE tenant_id+session_token_hash+view_date) for public menu_viewed analytics. Written only via record_menu_view(), a SECURITY DEFINER RPC granted only to service_role. Not tenant-member-readable -- this is bucketing/dedup bookkeeping, not a reporting table (analytics_events is the reporting table).';

-- Rate-limit lookups: count recent attempts for a given (tenant_id, ip_hash).
create index menu_view_attempts_tenant_ip_created_at_idx
  on menu_view_attempts (tenant_id, ip_hash, created_at desc);

alter table menu_view_attempts enable row level security;

-- No policies for anon/authenticated: like auth_rate_limit_attempts, this is
-- only ever written/read by the server-side service_role Supabase client
-- (via record_menu_view()), which bypasses RLS regardless. Enabling RLS with
-- zero grants for the app-facing roles is a deliberate deny-by-default
-- posture, consistent with every other table in this schema.
grant select, insert on menu_view_attempts to service_role;
revoke truncate on menu_view_attempts from anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- record_menu_view: rate-limited, deduplicated menu_viewed recorder
-- ----------------------------------------------------------------------------
create or replace function record_menu_view(
  p_tenant_id uuid,
  p_session_token_hash text,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Fixed, non-caller-configurable thresholds -- see migration header.
  menu_view_ip_rate_limit_max constant integer := 30;
  menu_view_ip_rate_limit_window constant interval := interval '10 minutes';
  v_today date := (now() at time zone 'utc')::date;
  v_ip_window_count integer;
  v_dedup_id uuid;
begin
  if p_tenant_id is null or p_session_token_hash is null or p_ip_hash is null then
    return false;
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    -- Defense-in-depth: the app layer always resolves p_tenant_id from the
    -- route slug and only calls this function when that lookup succeeded
    -- (see apps/web/src/app/r/[slug]/page.tsx), but this function fails
    -- closed (returns false, writes nothing) rather than throwing a raw FK
    -- violation up to the caller if it's ever invoked with an id that
    -- doesn't resolve to a real tenant.
    return false;
  end if;

  -- Serializes concurrent callers sharing this (tenant_id, ip_hash) bucket,
  -- same rationale as reserve_auth_rate_limit_attempt's advisory lock (see
  -- migration header).
  perform pg_advisory_xact_lock(
    hashtextextended('menu_view:' || p_tenant_id::text || ':' || p_ip_hash, 0)
  );

  select count(*)
    into v_ip_window_count
    from public.menu_view_attempts
   where tenant_id = p_tenant_id
     and ip_hash = p_ip_hash
     and created_at >= now() - menu_view_ip_rate_limit_window;

  if v_ip_window_count >= menu_view_ip_rate_limit_max then
    -- Rate-limited: reject outright, write nothing at all. This is what
    -- bounds row growth even against an attacker rotating session tokens
    -- specifically to defeat the per-session dedup below.
    --
    -- Both this branch and the dedup branch below return plain `false`, so
    -- the boolean return value alone can't distinguish "rate-limited" from
    -- "already recorded today" -- the app layer doesn't currently need that
    -- distinction to behave correctly (either way, nothing is written), but
    -- an operator investigating a suspiciously flat menu_viewed count for a
    -- tenant does. `raise log` (server-side Postgres log, never returned to
    -- the caller) makes the rate-limited case specifically greppable without
    -- changing the function's return type or the app's handling of it
    -- (Opus finding, PR #129).
    raise log
      'record_menu_view rate-limited: tenant_id=%, ip_hash=%, window_count=%',
      p_tenant_id, p_ip_hash, v_ip_window_count;
    return false;
  end if;

  insert into public.menu_view_attempts (tenant_id, session_token_hash, ip_hash, view_date)
  values (p_tenant_id, p_session_token_hash, p_ip_hash, v_today)
  on conflict (tenant_id, session_token_hash, view_date) do nothing
  returning id into v_dedup_id;

  if v_dedup_id is null then
    -- Deduped: this tenant+session already has a recorded view today.
    return false;
  end if;

  insert into public.analytics_events (tenant_id, event_type)
  values (p_tenant_id, 'menu_viewed');

  return true;
end;
$$;

comment on function record_menu_view(uuid, text, text) is
  'Ticket #67: records at most one menu_viewed analytics_events row per (tenant_id, session_token_hash, UTC day), and rejects outright once a (tenant_id, ip_hash) pair exceeds a fixed rate limit within a trailing window -- see migration header. p_tenant_id must already be resolved server-side from the public route slug (never a client-supplied value). Only service_role may call this.';

revoke all on function record_menu_view(uuid, text, text) from public;
grant execute on function record_menu_view(uuid, text, text) to service_role;
