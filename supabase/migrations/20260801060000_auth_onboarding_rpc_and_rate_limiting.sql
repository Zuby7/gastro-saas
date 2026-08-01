-- ============================================================================
-- Registration/onboarding RPC + auth rate-limiting table (ticket #7)
-- ============================================================================
-- Two independent pieces, both required for ticket #7's registration/login
-- flow:
--
-- 1. `create_tenant_with_owner(p_tenant_name, p_tenant_slug)` -- a
--    SECURITY DEFINER RPC that inserts a new tenant and its first Owner
--    membership atomically in a single statement/transaction, so ticket #4's
--    deferred `tenants_created_with_owner` constraint trigger (see
--    supabase/migrations/20260801040000_tenant_membership_brand_location_model.sql)
--    is satisfied at commit. Called via Supabase's `.rpc()` from the app's
--    registration server action, immediately after `supabase.auth.signUp()`
--    establishes a session for the new user (local dev has
--    `auth.enable_confirmations = false`, see supabase/config.toml, so a
--    session exists immediately after signUp -- no email-confirmation wait).
--
--    Deliberate deviation from the ticket's suggested signature
--    `create_tenant_with_owner(tenant_name, tenant_slug, owner_user_id)`:
--    this function takes NO owner_user_id parameter and instead resolves the
--    owner exclusively via `auth.uid()` inside the function body. Accepting
--    a client-supplied owner_user_id would let any authenticated caller pass
--    an arbitrary user id and make that other user the Owner of a brand-new
--    tenant -- a direct violation of "tenant context never comes from a
--    client-supplied value" (docs/security/tenant-isolation.md). Deriving it
--    from auth.uid() means the function can only ever make the *caller*
--    the Owner, which is the only shape this ticket's onboarding flow needs.
--
--    Hardened the same way as ticket #4's SECURITY DEFINER helpers
--    (`is_tenant_member`/`is_tenant_owner`): `set search_path = ''` plus
--    fully schema-qualified references, closing the pg_temp table-shadowing
--    bypass ticket #4's cycle-1 Opus review found for an equivalent pattern.
--
-- 2. `auth_rate_limit_attempts` -- a small, tenant-agnostic table backing a
--    fixed-window rate limiter for the registration/login server actions
--    (`.claude/rules/backend-api.md`: "rate-limit auth and checkout
--    endpoints"). Chosen over an in-memory limiter because this app is
--    deployed to Cloudflare Workers (docs/platform/service-register.md),
--    which runs multiple, independently-scaling, short-lived isolates with
--    no shared process memory -- an in-memory counter would silently reset
--    per isolate and per cold start, giving no real protection. A single
--    small Postgres table, written only via the server-side
--    service_role-backed Supabase client (never exposed to the browser),
--    is correct across instances and needs no new paid service (Supabase is
--    already the platform's Postgres, see the service register). Not
--    tenant-scoped (keyed by scope + IP + email, resolved before any tenant
--    context exists), so no tenant_id/is_tenant_member policy applies here --
--    RLS is still enabled with zero authenticated/anon policies (deny-by-
--    default posture, consistent with every other table in this schema)
--    even though service_role bypasses RLS entirely regardless.
--
--    No automated pruning of old rows is added here (out of scope for this
--    ticket) -- tracked as a residual concern for a future
--    operations/scheduled-job ticket; the table's growth rate is bounded by
--    real auth traffic, the same as any other request log.
--
-- Rollback: additive-only versus the previous migration. Down-migration a
-- maintainer can run by hand against a local/throwaway DB:
--   drop table if exists auth_rate_limit_attempts;
--   drop function if exists create_tenant_with_owner(text, text);
-- ============================================================================

-- ----------------------------------------------------------------------------
-- create_tenant_with_owner: atomic tenant + first-Owner-membership creation
-- ----------------------------------------------------------------------------
create or replace function create_tenant_with_owner(p_tenant_name text, p_tenant_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_user_id uuid;
  v_tenant_id uuid;
begin
  v_owner_user_id := auth.uid();

  if v_owner_user_id is null then
    raise exception 'create_tenant_with_owner requires an authenticated session'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.tenants (name, slug)
  values (p_tenant_name, p_tenant_slug)
  returning id into v_tenant_id;

  insert into public.tenant_memberships (tenant_id, user_id, role)
  values (v_tenant_id, v_owner_user_id, 'owner');

  return v_tenant_id;
end;
$$;

comment on function create_tenant_with_owner(text, text) is
  'Ticket #7 onboarding RPC: atomically creates a new tenant and its first Owner membership for the calling (auth.uid()) user, satisfying the tenants_created_with_owner deferred constraint trigger at commit. Deliberately takes no owner_user_id parameter -- the owner is always the authenticated caller, never a client-supplied id. search_path = '''' + schema-qualified refs to prevent pg_temp table-shadowing bypass, matching ticket #4''s SECURITY DEFINER hardening pattern.';

revoke all on function create_tenant_with_owner(text, text) from public;
grant execute on function create_tenant_with_owner(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- auth_rate_limit_attempts
-- ----------------------------------------------------------------------------
create table auth_rate_limit_attempts (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('login', 'register')),
  ip text not null check (char_length(ip) > 0),
  email text not null check (char_length(email) > 0),
  succeeded boolean not null default false,
  attempted_at timestamptz not null default now()
);

comment on table auth_rate_limit_attempts is
  'Ticket #7: fixed-window rate-limiting log for the registration/login server actions. Tenant-agnostic (no tenant context exists yet at the point these rows are written). Written only via the server-side service_role Supabase client, never exposed to the browser.';

create index auth_rate_limit_attempts_scope_ip_idx
  on auth_rate_limit_attempts (scope, ip, attempted_at desc);
create index auth_rate_limit_attempts_scope_email_idx
  on auth_rate_limit_attempts (scope, email, attempted_at desc);

alter table auth_rate_limit_attempts enable row level security;

-- No policies for anon/authenticated: this table is only ever written/read
-- by the server-side service_role client (which bypasses RLS regardless).
-- Enabling RLS with zero grants for the app-facing roles is a deliberate
-- deny-by-default posture, consistent with every other table in this schema.
grant select, insert on auth_rate_limit_attempts to service_role;
revoke truncate on auth_rate_limit_attempts from anon, authenticated, service_role;
