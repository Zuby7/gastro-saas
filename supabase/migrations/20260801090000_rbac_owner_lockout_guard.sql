-- ============================================================================
-- RBAC Owner lockout guard (ticket #10)
-- ============================================================================
-- Ticket #4 already protects tenant_memberships.role from removing/demoting
-- the last legacy Owner. Ticket #9 made membership_roles authoritative for
-- fine-grained permissions, so this migration adds the equivalent guard for
-- deleting/changing the final RBAC Owner role assignment.
--
-- Rollback for local/throwaway DBs:
--   drop trigger if exists membership_roles_owner_guard on membership_roles;
--   drop function if exists enforce_tenant_has_rbac_owner();
-- ============================================================================

create or replace function enforce_tenant_has_rbac_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_old_role_key text;
  v_remaining_owners integer;
begin
  select r.tenant_id, r.key
    into v_tenant_id, v_old_role_key
    from public.roles r
   where r.id = old.role_id;

  if v_tenant_id is null or v_old_role_key <> 'owner' then
    return null;
  end if;

  -- Whole-tenant deletion cascades through roles/membership_roles. In that
  -- path there is no remaining tenant to protect.
  if not exists (select 1 from public.tenants where id = v_tenant_id) then
    return null;
  end if;

  select count(*)
    into v_remaining_owners
    from public.membership_roles mr
    join public.roles r on r.id = mr.role_id
   where r.tenant_id = v_tenant_id
     and r.key = 'owner';

  if v_remaining_owners = 0 then
    raise exception
      'Tenant % must keep at least one Owner role assignment; refusing to remove the last Owner.',
      v_tenant_id
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

comment on function enforce_tenant_has_rbac_owner() is
  'Deferred guard preventing the final RBAC Owner role assignment from being removed while the tenant still exists. Complements the legacy tenant_memberships.role Owner guard from ticket #4.';

create constraint trigger membership_roles_owner_guard
  after update or delete on membership_roles
  deferrable initially deferred
  for each row
  execute function enforce_tenant_has_rbac_owner();

