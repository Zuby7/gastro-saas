-- ============================================================================
-- Additive default-permission catalog for seed_standard_roles_for_tenant()
-- (Ticket #114, fragile-pattern fix)
-- ============================================================================
-- Problem: seed_standard_roles_for_tenant() hardcoded every non-Owner system
-- role's default permissions as a `VALUES (...)` list inside the trigger
-- function body. Every permission-granting migration had to
-- `create or replace function` the *entire* function, hand-copying the
-- previous grant list forward. This has already silently dropped grants
-- twice (20260817110000 copied from an older version than 20260808130000 and
-- lost Manager's payments.read; fixed in 20260817120000, and flagged as
-- fragile in 20260808130000's own comments without ever being fixed).
--
-- Fix: move the non-Owner default grants into a small, additive lookup table,
-- `system_role_default_permissions(role_key, permission_key)`. Future
-- permission-granting migrations INSERT new rows into this table (mirroring
-- how they already INSERT into `permissions`/`role_permissions` for existing
-- tenants) instead of rewriting the trigger function body. Owner keeps its
-- existing "every catalog permission" cross-join with `permissions` --
-- unaffected by this change, and not moved into the new table because it is
-- not a fixed list to begin with.
--
-- Populated below with the exact current grant set, cross-checked against
-- the pinned expected-grant-matrix test in
-- packages/database/src/roles-permissions.integration.test.ts (the
-- authoritative source of truth per that test's own regression comment) and
-- 20260819110000_privacy_export_retention_and_deletion_requests.sql (the
-- migration that most recently `create or replace function`'d
-- seed_standard_roles_for_tenant()).
--
-- This migration does NOT touch any existing tenant's role_permissions rows
-- -- it only changes how *future* tenant creation seeds default grants.
--
-- Rollback for local/throwaway DBs:
--   create or replace function seed_standard_roles_for_tenant() ... -- (restore prior hardcoded-VALUES body from 20260819110000)
--   drop table if exists system_role_default_permissions;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Additive default-permission catalog (global, not tenant-scoped -- mirrors
-- `permissions`: a fixed code-facing catalog, not tenant data, so no
-- tenant_id / cross-tenant RLS test applies here).
-- ----------------------------------------------------------------------------
create table system_role_default_permissions (
  role_key text not null check (role_key ~ '^[a-z]+(-[a-z]+)*$'),
  permission_key text not null references permissions (key) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_key, permission_key)
);

comment on table system_role_default_permissions is
  'Ticket #114: additive catalog of which permission keys each non-Owner system role (manager/kitchen/service/marketing) receives by default when seed_standard_roles_for_tenant() seeds a freshly created tenant. Future permission-granting migrations INSERT additional rows here instead of rewriting seed_standard_roles_for_tenant()''s body, preventing the repeated full-body-reconstruction regressions this ticket fixes. Owner is deliberately NOT modelled here -- it keeps its existing cross-join-with-every-permissions-row behaviour in seed_standard_roles_for_tenant().';

alter table system_role_default_permissions enable row level security;

grant select on system_role_default_permissions to authenticated, service_role;
revoke truncate on system_role_default_permissions from anon, authenticated, service_role;

create policy system_role_default_permissions_select_authenticated
  on system_role_default_permissions
  for select
  to authenticated
  using (true);

-- ----------------------------------------------------------------------------
-- Populate with the exact current grant set (pinned by
-- roles-permissions.integration.test.ts's
-- "grants the exact expected default permission set per system role..." test).
-- ----------------------------------------------------------------------------
insert into system_role_default_permissions (role_key, permission_key)
values
  ('manager', 'users.invite'),
  ('manager', 'users.manage'),
  ('manager', 'menu.publish'),
  ('manager', 'menu.read'),
  ('manager', 'menu.availability.manage'),
  ('manager', 'orders.cancel'),
  ('manager', 'orders.read'),
  ('manager', 'orders.manage'),
  ('manager', 'payments.refund'),
  ('manager', 'payments.read'),
  ('manager', 'analytics.read'),
  ('manager', 'audit.read'),
  ('manager', 'reviews.read'),
  ('manager', 'reviews.moderate'),
  ('kitchen', 'menu.read'),
  ('kitchen', 'menu.availability.manage'),
  ('kitchen', 'orders.cancel'),
  ('kitchen', 'orders.read'),
  ('kitchen', 'orders.manage'),
  ('service', 'menu.read'),
  ('service', 'menu.availability.manage'),
  ('service', 'orders.cancel'),
  ('service', 'orders.read'),
  ('service', 'orders.manage'),
  ('marketing', 'menu.publish'),
  ('marketing', 'menu.read'),
  ('marketing', 'analytics.read')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Rewrite seed_standard_roles_for_tenant() to read non-Owner default grants
-- from the new table instead of a hardcoded VALUES list. Owner keeps its
-- existing cross-join-with-every-permission behaviour, unchanged.
-- ----------------------------------------------------------------------------
create or replace function seed_standard_roles_for_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Owner receives every catalog permission (unchanged behaviour -- not a
  -- fixed list, so not modelled in system_role_default_permissions).
  insert into public.role_permissions (role_id, permission_key)
  select r.id, p.key
    from public.roles r
   cross join public.permissions p
   where r.tenant_id = new.id
     and r.key = 'owner'
  on conflict do nothing;

  -- Every other system role's default grants are read additively from
  -- system_role_default_permissions -- new permission-granting migrations
  -- INSERT rows there instead of rewriting this function body.
  insert into public.role_permissions (role_id, permission_key)
  select r.id, sdp.permission_key
    from public.roles r
    join public.system_role_default_permissions sdp on sdp.role_key = r.key
   where r.tenant_id = new.id
     and r.key <> 'owner'
  on conflict do nothing;

  return new;
end;
$$;

comment on function seed_standard_roles_for_tenant() is
  'Creates the Owner/Manager/Kitchen/Service/Marketing system roles for a tenant and attaches their default permissions. Ticket #114: Owner still gets every catalog permission via cross-join with permissions; every other system role''s default grants are read additively from system_role_default_permissions instead of a hardcoded VALUES list, so future permission-granting migrations only need to INSERT a new row there.';
