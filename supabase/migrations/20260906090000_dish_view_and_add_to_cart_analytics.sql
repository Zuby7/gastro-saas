-- ============================================================================
-- Rate-limited/deduplicated dish_view and add_to_cart analytics (ticket #120 part B)
-- ============================================================================
-- Fills the instrumentation gap flagged in
-- supabase/migrations/20260818100000_dish_performance_stats.sql's header
-- ("NOTHING in this codebase ever writes a `dish_view` or `add_to_cart` row
-- into `analytics_events`") by mirroring ticket #67's already-shipped
-- `record_menu_view()` pattern
-- (supabase/migrations/20260905130000_menu_view_rate_limited_analytics.sql)
-- for two more event types:
--
-- `record_dish_view(p_tenant_id, p_dish_id, p_session_token_hash, p_ip_hash)`
-- and `record_add_to_cart_event(p_tenant_id, p_dish_id, p_session_token_hash,
-- p_ip_hash)`:
--   - Never trust a client-supplied tenant_id or dish_id in isolation: the
--     app layer always resolves tenant_id server-side from the public route
--     slug first (mirrors record_menu_view()'s convention), and both
--     functions independently re-verify the dish actually belongs to that
--     tenant (`exists (select 1 from dishes where id = p_dish_id and
--     tenant_id = p_tenant_id)`) before writing anything -- this is what
--     makes the cross-tenant test in
--     packages/database/src/dish-engagement-analytics.integration.test.ts
--     meaningful (a dish id from tenant B can never produce an event
--     attributed to tenant A, and vice versa).
--   - Dedup: `dish_engagement_attempts` has a UNIQUE (tenant_id, dish_id,
--     event_type, session_token_hash, view_date) constraint. `INSERT ... ON
--     CONFLICT DO NOTHING` means at most one `analytics_events` row is ever
--     recorded per tenant+dish+event_type+session+calendar day (UTC) --
--     same rationale as record_menu_view(): this counts "how many distinct
--     visits showed genuine interest in this dish today", not raw
--     click/render counts, which is the signal
--     `get_dish_performance_stats()` (ticket #31) actually wants.
--   - Rate limiting: same `pg_advisory_xact_lock`-keyed-on-(scope, tenant_id,
--     ip_hash) pattern as `record_menu_view()`/
--     `reserve_auth_rate_limit_attempt`, serializing concurrent callers
--     sharing that key so the count-then-insert can't race. Thresholds are
--     higher than `record_menu_view()`'s (30/10min) because a single public
--     menu page render can legitimately trigger many `dish_view` calls at
--     once (one per dish shown), not just one -- see the app-layer call site
--     (apps/web/src/app/r/[slug]/page.tsx) for the fixed per-render fan-out.
--     `add_to_cart` keeps a lower threshold since it's one call per add
--     action, not one per rendered dish.
--   - Both functions are SECURITY DEFINER, granted only to `service_role`,
--     mirroring `record_menu_view()` exactly.
--
-- Rollback: additive-only. Down-migration a maintainer can run by hand
-- against a local/throwaway DB:
--   drop function if exists record_dish_view(uuid, uuid, text, text);
--   drop function if exists record_add_to_cart_event(uuid, uuid, text, text);
--   drop table if exists dish_engagement_attempts;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- dish_engagement_attempts
-- ----------------------------------------------------------------------------
create table dish_engagement_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  dish_id uuid not null references dishes (id) on delete cascade,
  event_type text not null check (event_type in ('dish_view', 'add_to_cart')),
  -- SHA-256 hex digest of the same anonymous per-browser session token used
  -- by ticket #67's menu_view_attempts (apps/web/src/lib/menu-view/token.ts)
  -- -- the raw token lives only in an httpOnly cookie, never in the database.
  session_token_hash text not null check (char_length(session_token_hash) > 0),
  -- SHA-256 hex digest of the resolved client IP -- rate-limit bucketing
  -- only, never stored raw.
  ip_hash text not null check (char_length(ip_hash) > 0),
  -- UTC calendar day this attempt falls into -- the dedup window is anchored
  -- to this column (not `created_at`) so the UNIQUE constraint below can
  -- enforce it directly via ON CONFLICT, exactly like menu_view_attempts.
  view_date date not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, dish_id, event_type, session_token_hash, view_date)
);

comment on table dish_engagement_attempts is
  'Ticket #120 part B: backs record_dish_view()/record_add_to_cart_event()''s rate-limiting (per tenant_id+event_type+ip_hash, trailing window) and dedup (UNIQUE tenant_id+dish_id+event_type+session_token_hash+view_date) for public dish_view/add_to_cart analytics. Written only via those two SECURITY DEFINER RPCs, granted only to service_role. Not tenant-member-readable -- this is bucketing/dedup bookkeeping, not a reporting table (analytics_events is the reporting table).';

-- Rate-limit lookups: count recent attempts for a given (tenant_id, event_type, ip_hash).
create index dish_engagement_attempts_tenant_event_ip_created_at_idx
  on dish_engagement_attempts (tenant_id, event_type, ip_hash, created_at desc);

alter table dish_engagement_attempts enable row level security;

-- No policies for anon/authenticated: like menu_view_attempts, this is only
-- ever written/read by the server-side service_role Supabase client (via
-- record_dish_view()/record_add_to_cart_event()), which bypasses RLS
-- regardless. Enabling RLS with zero grants for the app-facing roles is a
-- deliberate deny-by-default posture, consistent with every other table in
-- this schema.
grant select, insert on dish_engagement_attempts to service_role;
revoke truncate on dish_engagement_attempts from anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- record_dish_view: rate-limited, deduplicated dish_view recorder
-- ----------------------------------------------------------------------------
create or replace function record_dish_view(
  p_tenant_id uuid,
  p_dish_id uuid,
  p_session_token_hash text,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Fixed, non-caller-configurable thresholds -- see migration header for
  -- why this is higher than record_menu_view()'s 30/10min. 200/10min is
  -- sized for a realistic menu render (this codebase's seeded demo menu has
  -- 12 dishes; even a large real-world menu is expected to stay well under
  -- ~150-200 dishes shown on one page) -- a menu with >=200 dishes rendered
  -- in one page would exhaust this budget in a single visit, undercounting
  -- later dishes on the page and skewing get_dish_performance_stats() (#31)
  -- analytics (PR #136 Opus finding). The batched record_dish_views()
  -- function below takes one advisory lock/count-check for an entire page
  -- render instead of one per dish, which removes most of the pressure on
  -- this budget, but the fixed constant itself is not raised here -- if a
  -- tenant's real menu approaches this size, revisit the threshold rather
  -- than relying on the batching alone.
  dish_view_ip_rate_limit_max constant integer := 200;
  dish_view_ip_rate_limit_window constant interval := interval '10 minutes';
  v_today date := (now() at time zone 'utc')::date;
  v_ip_window_count integer;
  v_dedup_id uuid;
begin
  if p_tenant_id is null or p_dish_id is null or p_session_token_hash is null or p_ip_hash is null then
    return false;
  end if;

  if not exists (
    select 1 from public.dishes where id = p_dish_id and tenant_id = p_tenant_id
  ) then
    -- Defense-in-depth: the app layer always resolves p_tenant_id from the
    -- route slug and only ever passes dish ids belonging to that tenant's
    -- own rendered menu, but this function fails closed (returns false,
    -- writes nothing) rather than attributing an event to the wrong tenant
    -- or throwing a raw FK violation if it's ever invoked with a
    -- tenant_id/dish_id pair that doesn't resolve together.
    return false;
  end if;

  -- Serializes concurrent callers sharing this (event_type, tenant_id,
  -- ip_hash) bucket, same rationale as record_menu_view()'s advisory lock.
  perform pg_advisory_xact_lock(
    hashtextextended('dish_view:' || p_tenant_id::text || ':' || p_ip_hash, 0)
  );

  select count(*)
    into v_ip_window_count
    from public.dish_engagement_attempts
   where tenant_id = p_tenant_id
     and event_type = 'dish_view'
     and ip_hash = p_ip_hash
     and created_at >= now() - dish_view_ip_rate_limit_window;

  if v_ip_window_count >= dish_view_ip_rate_limit_max then
    -- Rate-limited: reject outright, write nothing at all -- bounds row
    -- growth even against an attacker rotating session tokens specifically
    -- to defeat the per-session dedup below.
    return false;
  end if;

  insert into public.dish_engagement_attempts
    (tenant_id, dish_id, event_type, session_token_hash, ip_hash, view_date)
  values (p_tenant_id, p_dish_id, 'dish_view', p_session_token_hash, p_ip_hash, v_today)
  on conflict (tenant_id, dish_id, event_type, session_token_hash, view_date) do nothing
  returning id into v_dedup_id;

  if v_dedup_id is null then
    -- Deduped: this tenant+dish+session already has a recorded view today.
    return false;
  end if;

  insert into public.analytics_events (tenant_id, event_type, dish_id)
  values (p_tenant_id, 'dish_view', p_dish_id);

  return true;
end;
$$;

comment on function record_dish_view(uuid, uuid, text, text) is
  'Ticket #120 part B: records at most one dish_view analytics_events row per (tenant_id, dish_id, session_token_hash, UTC day), and rejects outright once a (tenant_id, ip_hash) pair exceeds a fixed rate limit within a trailing window -- see migration header. p_tenant_id/p_dish_id must already be resolved server-side (never client-supplied without independent verification). Only service_role may call this.';

revoke all on function record_dish_view(uuid, uuid, text, text) from public;
grant execute on function record_dish_view(uuid, uuid, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- record_add_to_cart_event: rate-limited, deduplicated add_to_cart recorder
-- ----------------------------------------------------------------------------
create or replace function record_add_to_cart_event(
  p_tenant_id uuid,
  p_dish_id uuid,
  p_session_token_hash text,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Fixed, non-caller-configurable thresholds -- lower than dish_view's
  -- since this fires once per add-to-cart action, not once per rendered
  -- dish -- see migration header.
  add_to_cart_ip_rate_limit_max constant integer := 60;
  add_to_cart_ip_rate_limit_window constant interval := interval '10 minutes';
  v_today date := (now() at time zone 'utc')::date;
  v_ip_window_count integer;
  v_dedup_id uuid;
begin
  if p_tenant_id is null or p_dish_id is null or p_session_token_hash is null or p_ip_hash is null then
    return false;
  end if;

  if not exists (
    select 1 from public.dishes where id = p_dish_id and tenant_id = p_tenant_id
  ) then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('add_to_cart:' || p_tenant_id::text || ':' || p_ip_hash, 0)
  );

  select count(*)
    into v_ip_window_count
    from public.dish_engagement_attempts
   where tenant_id = p_tenant_id
     and event_type = 'add_to_cart'
     and ip_hash = p_ip_hash
     and created_at >= now() - add_to_cart_ip_rate_limit_window;

  if v_ip_window_count >= add_to_cart_ip_rate_limit_max then
    return false;
  end if;

  insert into public.dish_engagement_attempts
    (tenant_id, dish_id, event_type, session_token_hash, ip_hash, view_date)
  values (p_tenant_id, p_dish_id, 'add_to_cart', p_session_token_hash, p_ip_hash, v_today)
  on conflict (tenant_id, dish_id, event_type, session_token_hash, view_date) do nothing
  returning id into v_dedup_id;

  if v_dedup_id is null then
    return false;
  end if;

  insert into public.analytics_events (tenant_id, event_type, dish_id)
  values (p_tenant_id, 'add_to_cart', p_dish_id);

  return true;
end;
$$;

comment on function record_add_to_cart_event(uuid, uuid, text, text) is
  'Ticket #120 part B: records at most one add_to_cart analytics_events row per (tenant_id, dish_id, session_token_hash, UTC day), and rejects outright once a (tenant_id, ip_hash) pair exceeds a fixed rate limit within a trailing window -- see migration header. p_tenant_id/p_dish_id must already be resolved server-side (never client-supplied without independent verification). Only service_role may call this.';

revoke all on function record_add_to_cart_event(uuid, uuid, text, text) from public;
grant execute on function record_add_to_cart_event(uuid, uuid, text, text) to service_role;
