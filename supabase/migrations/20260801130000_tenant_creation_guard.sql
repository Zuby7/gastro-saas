-- ============================================================================
-- Guard against unbounded tenant creation per user (Codex review finding,
-- also a low finding in ticket #7's Opus review cycle 2 / artifacts/reviews/
-- issue-7.json: "createTenantAction has no server-side zero-membership
-- guard -- unbounded tenant creation per user"). create_tenant_with_owner()
-- was merged in 20260801060000_auth_onboarding_rpc_and_rate_limiting.sql --
-- that migration is already on main, so it's amended here via
-- `create or replace function` rather than edited in place.
--
-- Fix is at the DB layer (not just the app-layer /account form), since the
-- RPC is directly callable by any authenticated user via PostgREST/.rpc(),
-- bypassing the createTenantAction server action entirely.
--
-- Rollback: `create or replace function create_tenant_with_owner(...)`
-- reverting to the prior body (see 20260801060000's version), or
-- `drop function create_tenant_with_owner(text, text)` plus re-running that
-- migration's create statement.
-- ============================================================================

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

  if exists (select 1 from public.tenant_memberships where user_id = v_owner_user_id) then
    raise exception 'This account already belongs to a tenant'
      using errcode = 'unique_violation';
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
  'Ticket #7 onboarding RPC (hardened 2026-08-01 against unbounded per-user tenant creation): atomically creates a new tenant and its first Owner membership for the calling (auth.uid()) user, satisfying the tenants_created_with_owner deferred constraint trigger at commit. Rejects the call if the caller already belongs to any tenant. Owner is always the authenticated caller, never a client-supplied id. search_path = '''' + schema-qualified refs per ticket #4''s SECURITY DEFINER hardening pattern.';
