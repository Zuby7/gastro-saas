-- ============================================================================
-- Roles and granular permissions (ticket #9)
-- ============================================================================
-- Adds tenant-scoped RBAC on top of the minimal ticket #4
-- tenant_memberships.role column. The legacy column stays in place for the
-- existing Owner invariant and simple account UI; membership_roles is the
-- authoritative fine-grained permission assignment surface going forward.
--
-- Rollback for local/throwaway DBs:
--   drop policy if exists analytics_events_select_with_permission on analytics_events;
--   create policy analytics_events_select_member on analytics_events for select to authenticated using (is_tenant_member(tenant_id));
--   drop trigger if exists audit_membership_roles_changes on membership_roles;
--   drop trigger if exists audit_role_permissions_changes on role_permissions;
--   drop function if exists audit_rbac_change();
--   drop trigger if exists tenant_memberships_sync_standard_role on tenant_memberships;
--   drop function if exists sync_membership_standard_role();
--   drop trigger if exists tenants_seed_standard_roles on tenants;
--   drop function if exists seed_standard_roles_for_tenant();
--   drop function if exists require_tenant_permission(uuid, text);
--   drop function if exists has_tenant_permission(uuid, text);
--   drop function if exists enforce_membership_role_same_tenant();
--   drop table if exists membership_roles;
--   drop table if exists role_permissions;
--   drop table if exists roles;
--   drop table if exists permissions;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Global permission catalog
-- ----------------------------------------------------------------------------
create table permissions (
  key text primary key check (key ~ '^[a-z]+(\.[a-z]+)+$'),
  description text not null check (char_length(description) > 0),
  created_at timestamptz not null default now()
);

comment on table permissions is
  'Global catalog of permission keys. Keys are intentionally code-facing (area.resource.action); tenant-specific assignment happens through roles.';

insert into permissions (key, description)
values
  ('users.invite', 'Invite users into a tenant'),
  ('users.manage', 'Change tenant memberships and role assignments'),
  ('roles.manage', 'Create and maintain custom tenant roles'),
  ('menu.publish', 'Publish menu changes'),
  ('orders.cancel', 'Cancel orders'),
  ('payments.refund', 'Issue payment refunds'),
  ('analytics.read', 'Read revenue and analytics data'),
  ('audit.read', 'Read tenant audit logs')
on conflict (key) do update set description = excluded.description;

alter table permissions enable row level security;
grant select on permissions to authenticated, service_role;

create policy permissions_select_authenticated
  on permissions
  for select
  to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- Tenant roles and assignments
-- ----------------------------------------------------------------------------
create table roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  key text not null check (key ~ '^[a-z]+(-[a-z]+)*$'),
  name text not null check (char_length(name) > 0),
  description text not null default '',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

comment on table roles is
  'Tenant-scoped roles. System roles are seeded per tenant; tenants may add custom roles gated by roles.manage.';

create trigger roles_set_updated_at
  before update on roles
  for each row
  execute function set_updated_at();

create index roles_tenant_id_idx on roles (tenant_id);

create table role_permissions (
  role_id uuid not null references roles (id) on delete cascade,
  permission_key text not null references permissions (key) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

comment on table role_permissions is
  'Permission grants attached to one tenant role.';

create index role_permissions_permission_key_idx on role_permissions (permission_key);

create table membership_roles (
  membership_id uuid not null references tenant_memberships (id) on delete cascade,
  role_id uuid not null references roles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (membership_id, role_id)
);

comment on table membership_roles is
  'Role assignments for tenant memberships. Role and membership must belong to the same tenant.';

create index membership_roles_role_id_idx on membership_roles (role_id);

-- ----------------------------------------------------------------------------
-- Same-tenant guard for membership_roles
-- ----------------------------------------------------------------------------
create or replace function enforce_membership_role_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_tenant_id uuid;
  v_role_tenant_id uuid;
begin
  select tenant_id into v_membership_tenant_id
    from public.tenant_memberships
   where id = new.membership_id;

  select tenant_id into v_role_tenant_id
    from public.roles
   where id = new.role_id;

  if v_membership_tenant_id is null
     or v_role_tenant_id is null
     or v_membership_tenant_id <> v_role_tenant_id
  then
    raise exception 'membership_roles must assign a role from the same tenant as the membership'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function enforce_membership_role_same_tenant() is
  'Prevents assigning a role from tenant A to a membership from tenant B. SECURITY DEFINER with search_path = '''' and schema-qualified references.';

create trigger membership_roles_same_tenant
  before insert or update on membership_roles
  for each row
  execute function enforce_membership_role_same_tenant();

-- ----------------------------------------------------------------------------
-- Permission helpers used by application code and RLS policies
-- ----------------------------------------------------------------------------
create or replace function has_tenant_permission(p_tenant_id uuid, p_permission_key text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.tenant_memberships tm
      join public.membership_roles mr on mr.membership_id = tm.id
      join public.role_permissions rp on rp.role_id = mr.role_id
     where tm.tenant_id = p_tenant_id
       and tm.user_id = auth.uid()
       and rp.permission_key = p_permission_key
  );
$$;

comment on function has_tenant_permission(uuid, text) is
  'True if the current auth.uid() has the requested permission in the tenant through membership_roles. Used by server-side checks and RLS policies.';

create or replace function require_tenant_permission(p_tenant_id uuid, p_permission_key text)
returns void
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  if not public.has_tenant_permission(p_tenant_id, p_permission_key) then
    raise exception 'Missing permission % for tenant %', p_permission_key, p_tenant_id
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

comment on function require_tenant_permission(uuid, text) is
  'Raises insufficient_privilege unless auth.uid() has the requested tenant permission. Application mutations should call this before sensitive reads/writes.';

revoke all on function has_tenant_permission(uuid, text) from public;
revoke all on function require_tenant_permission(uuid, text) from public;
grant execute on function has_tenant_permission(uuid, text) to authenticated, service_role;
grant execute on function require_tenant_permission(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Standard role seeding
-- ----------------------------------------------------------------------------
create or replace function seed_standard_roles_for_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_role_id uuid;
  v_manager_role_id uuid;
  v_kitchen_role_id uuid;
  v_service_role_id uuid;
  v_marketing_role_id uuid;
begin
  insert into public.roles (tenant_id, key, name, description, is_system)
  values
    (new.id, 'owner', 'Owner', 'Full tenant administration and safety-critical permissions.', true),
    (new.id, 'manager', 'Manager', 'Operational tenant management without role-template administration.', true),
    (new.id, 'kitchen', 'Kitchen', 'Kitchen workflow access only.', true),
    (new.id, 'service', 'Service', 'Service and order workflow access.', true),
    (new.id, 'marketing', 'Marketing', 'Menu publishing and analytics access without payment authority.', true)
  on conflict (tenant_id, key) do update
     set name = excluded.name,
         description = excluded.description,
         is_system = true;

  select id into v_owner_role_id from public.roles where tenant_id = new.id and key = 'owner';
  select id into v_manager_role_id from public.roles where tenant_id = new.id and key = 'manager';
  select id into v_kitchen_role_id from public.roles where tenant_id = new.id and key = 'kitchen';
  select id into v_service_role_id from public.roles where tenant_id = new.id and key = 'service';
  select id into v_marketing_role_id from public.roles where tenant_id = new.id and key = 'marketing';

  insert into public.role_permissions (role_id, permission_key)
  select v_owner_role_id, key from public.permissions
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission_key)
  values
    (v_manager_role_id, 'users.invite'),
    (v_manager_role_id, 'users.manage'),
    (v_manager_role_id, 'menu.publish'),
    (v_manager_role_id, 'orders.cancel'),
    (v_manager_role_id, 'payments.refund'),
    (v_manager_role_id, 'analytics.read'),
    (v_manager_role_id, 'audit.read'),
    (v_kitchen_role_id, 'orders.cancel'),
    (v_service_role_id, 'orders.cancel'),
    (v_marketing_role_id, 'menu.publish'),
    (v_marketing_role_id, 'analytics.read')
  on conflict do nothing;

  return new;
end;
$$;

comment on function seed_standard_roles_for_tenant() is
  'Creates the Owner/Manager/Kitchen/Service/Marketing system roles for a tenant and attaches their default permissions.';

create trigger tenants_seed_standard_roles
  after insert on tenants
  for each row
  execute function seed_standard_roles_for_tenant();

-- Seed roles for existing tenants.
insert into roles (tenant_id, key, name, description, is_system)
select t.id, seed.key, seed.name, seed.description, true
  from tenants t
 cross join (
   values
     ('owner', 'Owner', 'Full tenant administration and safety-critical permissions.'),
     ('manager', 'Manager', 'Operational tenant management without role-template administration.'),
     ('kitchen', 'Kitchen', 'Kitchen workflow access only.'),
     ('service', 'Service', 'Service and order workflow access.'),
     ('marketing', 'Marketing', 'Menu publishing and analytics access without payment authority.')
 ) as seed(key, name, description)
on conflict (tenant_id, key) do update
   set name = excluded.name,
       description = excluded.description,
       is_system = true;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
  from roles r
 cross join permissions p
 where r.key = 'owner'
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, grants.permission_key
  from roles r
  join (
    values
      ('manager', 'users.invite'),
      ('manager', 'users.manage'),
      ('manager', 'menu.publish'),
      ('manager', 'orders.cancel'),
      ('manager', 'payments.refund'),
      ('manager', 'analytics.read'),
      ('manager', 'audit.read'),
      ('kitchen', 'orders.cancel'),
      ('service', 'orders.cancel'),
      ('marketing', 'menu.publish'),
      ('marketing', 'analytics.read')
  ) as grants(role_key, permission_key) on grants.role_key = r.key
on conflict do nothing;

create or replace function sync_membership_standard_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_standard_role_key text;
begin
  v_standard_role_key := case new.role
    when 'owner' then 'owner'
    when 'manager' then 'manager'
    else 'service'
  end;

  delete from public.membership_roles mr
   using public.roles r
   where mr.role_id = r.id
     and mr.membership_id = new.id
     and r.tenant_id = new.tenant_id
     and r.is_system = true
     and r.key in ('owner', 'manager', 'kitchen', 'service', 'marketing');

  insert into public.membership_roles (membership_id, role_id)
  select new.id, r.id
    from public.roles r
   where r.tenant_id = new.tenant_id
     and r.key = v_standard_role_key
  on conflict do nothing;

  return new;
end;
$$;

comment on function sync_membership_standard_role() is
  'Backwards-compatible bridge from tenant_memberships.role to the standard RBAC role assignment. staff maps to Service.';

create trigger tenant_memberships_sync_standard_role
  after insert or update of role on tenant_memberships
  for each row
  execute function sync_membership_standard_role();

insert into membership_roles (membership_id, role_id)
select tm.id, r.id
  from tenant_memberships tm
  join roles r
    on r.tenant_id = tm.tenant_id
   and r.key = case tm.role when 'owner' then 'owner' when 'manager' then 'manager' else 'service' end
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- RLS policies
-- ----------------------------------------------------------------------------
alter table roles enable row level security;
alter table role_permissions enable row level security;
alter table membership_roles enable row level security;

grant select, insert, update, delete on roles to authenticated;
grant select, insert, update, delete on role_permissions to authenticated;
grant select, insert, delete on membership_roles to authenticated;
grant select, insert, update, delete on roles to service_role;
grant select, insert, update, delete on role_permissions to service_role;
grant select, insert, update, delete on membership_roles to service_role;
revoke truncate on roles, role_permissions, membership_roles from anon, authenticated, service_role;

create policy roles_select_member
  on roles
  for select
  to authenticated
  using (is_tenant_member(tenant_id));

create policy roles_insert_roles_manage
  on roles
  for insert
  to authenticated
  with check (has_tenant_permission(tenant_id, 'roles.manage') and is_system = false);

create policy roles_update_roles_manage
  on roles
  for update
  to authenticated
  using (has_tenant_permission(tenant_id, 'roles.manage') and is_system = false)
  with check (has_tenant_permission(tenant_id, 'roles.manage') and is_system = false);

create policy roles_delete_roles_manage
  on roles
  for delete
  to authenticated
  using (has_tenant_permission(tenant_id, 'roles.manage') and is_system = false);

create policy role_permissions_select_member
  on role_permissions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.roles r
       where r.id = role_id
         and is_tenant_member(r.tenant_id)
    )
  );

create policy role_permissions_insert_roles_manage
  on role_permissions
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.roles r
       where r.id = role_id
         and r.is_system = false
         and has_tenant_permission(r.tenant_id, 'roles.manage')
    )
  );

create policy role_permissions_delete_roles_manage
  on role_permissions
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.roles r
       where r.id = role_id
         and r.is_system = false
         and has_tenant_permission(r.tenant_id, 'roles.manage')
    )
  );

create policy membership_roles_select_member
  on membership_roles
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.tenant_memberships tm
       where tm.id = membership_id
         and is_tenant_member(tm.tenant_id)
    )
  );

-- Opus batch review (epic-3-5-batch, high, privilege escalation): a
-- users.manage holder could previously assign the system 'owner' role to
-- any membership (including their own), self-escalating to Owner (gaining
-- roles.manage, payments.refund, etc). Assigning (or revoking, see the
-- delete policy below) the 'owner' role now additionally requires
-- roles.manage -- users.manage alone is no longer sufficient for that one
-- role key.
create policy membership_roles_insert_users_manage
  on membership_roles
  for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.tenant_memberships tm
        join public.roles r on r.id = role_id and r.tenant_id = tm.tenant_id
       where tm.id = membership_id
         and has_tenant_permission(tm.tenant_id, 'users.manage')
         and (r.key <> 'owner' or has_tenant_permission(tm.tenant_id, 'roles.manage'))
    )
  );

-- Same rule as the insert policy above: revoking an 'owner' role assignment
-- also requires roles.manage, not just users.manage.
create policy membership_roles_delete_users_manage
  on membership_roles
  for delete
  to authenticated
  using (
    exists (
      select 1
        from public.tenant_memberships tm
        join public.roles r on r.id = role_id and r.tenant_id = tm.tenant_id
       where tm.id = membership_id
         and has_tenant_permission(tm.tenant_id, 'users.manage')
         and (r.key <> 'owner' or has_tenant_permission(tm.tenant_id, 'roles.manage'))
    )
  );

-- Revenue/analytics data is no longer visible to every tenant member. This
-- closes the concrete #9 boundary: Kitchen must not read revenue data.
drop policy if exists analytics_events_select_member on analytics_events;

create policy analytics_events_select_with_permission
  on analytics_events
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'analytics.read'));

-- ----------------------------------------------------------------------------
-- Audit role/permission changes
-- ----------------------------------------------------------------------------
create or replace function audit_rbac_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role text := current_setting('role', true);
  v_actor_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_target_id text;
begin
  if v_caller_role not in ('authenticated', 'service_role') then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_table_name = 'role_permissions' then
    select tenant_id into v_tenant_id
      from public.roles
     where id = coalesce(new.role_id, old.role_id);
    v_target_id := coalesce(new.role_id, old.role_id)::text;
  elsif tg_table_name = 'membership_roles' then
    select tm.tenant_id into v_tenant_id
      from public.tenant_memberships tm
     where tm.id = coalesce(new.membership_id, old.membership_id);
    v_target_id := coalesce(new.membership_id, old.membership_id)::text;
  end if;

  if v_tenant_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  insert into public.audit_logs (tenant_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    v_tenant_id,
    v_actor_user_id,
    'authorization.' || lower(tg_op),
    tg_table_name,
    v_target_id,
    jsonb_build_object('table', tg_table_name, 'operation', tg_op)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function audit_rbac_change() is
  'Appends audit_logs rows for RBAC assignment/permission changes performed by app-facing roles.';

create trigger audit_role_permissions_changes
  after insert or delete on role_permissions
  for each row
  execute function audit_rbac_change();

create trigger audit_membership_roles_changes
  after insert or delete on membership_roles
  for each row
  execute function audit_rbac_change();
