-- ============================================================================
-- Real tenant / membership / brand / location data model (ticket #4)
-- ============================================================================
-- Introduces the actual domain tables listed under "Identity & tenancy" in
-- docs/data/domain-model.md: `tenants`, `tenant_memberships`, `brands`,
-- `locations`. Supersedes and drops the disposable example tables shipped by
-- ticket #3 (supabase/migrations/20260801030000_example_tenant_isolation_pattern.sql),
-- per that migration's own header comment and PR #44's description.
--
-- Scope notes (see ticket #4 and docs/data/domain-model.md "Authorization"):
--   - Full RBAC (`roles`, `permissions`, `role_permissions`, `membership_roles`)
--     is explicitly out of scope here -- that's ticket #9. `tenant_memberships`
--     gets a minimal fixed-set `role` text column (owner | manager | staff) so
--     ticket #9 can later replace/extend it without this ticket blocking that
--     work.
--   - No multi-location management UI (explicit non-goal) -- this migration
--     only models the data shape.
--   - Tenant context is never taken from client input: every RLS policy below
--     keys off `auth.uid()` resolved against the caller's own membership rows,
--     never a client-supplied tenant_id (docs/security/tenant-isolation.md).
--   - Client-side (authenticated role) INSERT into `tenants` / the first
--     `tenant_memberships` row is intentionally NOT granted by any RLS policy
--     in this migration -- that would require deciding the exact onboarding
--     transaction shape (ticket #7: registration/onboarding, and ticket #8:
--     invitations), which is out of scope for the data model ticket. Until
--     those land, tenant/first-owner-membership creation happens through the
--     `service_role` (which bypasses RLS by design), e.g. migrations, seed
--     scripts, or a future SECURITY DEFINER onboarding RPC. This does not
--     weaken tenant isolation: it only restricts who may create brand-new
--     tenants, not who may read/write within one they already belong to.
--
-- "At least one Owner at all times" (acceptance criterion):
-- Enforced at the database level via a DEFERRABLE INITIALLY DEFERRED
-- constraint trigger on `tenant_memberships` that fires only on UPDATE/DELETE
-- of an existing Owner row (never on INSERT), and only evaluates at
-- transaction commit. This avoids the chicken-and-egg problem on a tenant's
-- very first membership insert (there is nothing to check yet -- adding a
-- membership can never reduce the Owner count) while still blocking, at
-- commit time, any transaction that would leave a tenant with zero Owners
-- (e.g. deleting the last Owner row, or demoting the last Owner to
-- manager/staff). Because the check is deferred to commit, a single
-- transaction that removes one Owner while adding/promoting another Owner in
-- the same transaction is still allowed. A tenant that is created but never
-- given an Owner membership at all is a distinct, application-level
-- responsibility of ticket #7's onboarding flow (it must create the tenant
-- and its first Owner membership in one transaction/RPC); this trigger cannot
-- observe that gap because it lives on `tenant_memberships`, not `tenants`.
--
-- Rollback: additive-only versus the previous migration (drops three
-- example-only tables, creates four real ones + helper functions/triggers).
-- Down-migration a maintainer can run by hand against a local/throwaway DB:
--   drop table if exists locations;
--   drop table if exists brands;
--   drop trigger if exists tenant_memberships_owner_guard on tenant_memberships;
--   drop function if exists enforce_tenant_has_owner();
--   drop table if exists tenant_memberships;
--   drop table if exists tenants;
--   drop function if exists is_tenant_owner(uuid);
--   drop function if exists is_tenant_member(uuid);
--   drop function if exists set_updated_at();
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Drop the disposable example tables from ticket #3 (superseded by this file)
-- ----------------------------------------------------------------------------
drop table if exists example_tenant_notes;
drop table if exists example_tenant_memberships;
drop table if exists example_tenants;

-- ----------------------------------------------------------------------------
-- Shared helper: keep `updated_at` current on every row update.
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- tenants
-- ----------------------------------------------------------------------------
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table tenants is
  'A tenant = one restaurant/operator account. Root of tenant isolation -- every other tenant-scoped table references this.';

create trigger tenants_set_updated_at
  before update on tenants
  for each row
  execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- tenant_memberships
-- ----------------------------------------------------------------------------
-- Minimal role model for ticket #4: a fixed, small set of roles. This is
-- intentionally NOT the full RBAC model (roles/permissions/role_permissions/
-- membership_roles tables, ticket #9) -- just enough so later tickets have a
-- `role` to key off without this ticket blocking on that scope.
create table tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

comment on table tenant_memberships is
  'Which auth user belongs to which tenant, with a minimal fixed role (owner|manager|staff). Superseded/extended by the full RBAC model in ticket #9.';

create trigger tenant_memberships_set_updated_at
  before update on tenant_memberships
  for each row
  execute function set_updated_at();

create index tenant_memberships_tenant_id_idx on tenant_memberships (tenant_id);
create index tenant_memberships_user_id_idx on tenant_memberships (user_id);

-- ----------------------------------------------------------------------------
-- RLS helper functions -- SECURITY DEFINER so policies that reference
-- `tenant_memberships` from other tables' policies (and from
-- tenant_memberships' own policies) don't recurse through RLS on
-- tenant_memberships itself, and don't depend on the caller already having
-- row-visibility into the table being queried. These functions never accept
-- a tenant_id from anywhere other than the row being checked -- the *acting
-- user* is always resolved via auth.uid(), never a client-supplied value.
-- ----------------------------------------------------------------------------
create or replace function is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from tenant_memberships
    where tenant_id = p_tenant_id
      and user_id = auth.uid()
  );
$$;

comment on function is_tenant_member(uuid) is
  'True if the currently authenticated user (auth.uid()) has any membership row for the given tenant. SECURITY DEFINER to avoid RLS self-recursion on tenant_memberships.';

create or replace function is_tenant_owner(p_tenant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from tenant_memberships
    where tenant_id = p_tenant_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

comment on function is_tenant_owner(uuid) is
  'True if the currently authenticated user (auth.uid()) has an Owner membership for the given tenant. SECURITY DEFINER to avoid RLS self-recursion on tenant_memberships.';

revoke all on function is_tenant_member(uuid) from public;
revoke all on function is_tenant_owner(uuid) from public;
grant execute on function is_tenant_member(uuid) to authenticated, service_role;
grant execute on function is_tenant_owner(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- tenants RLS
-- ----------------------------------------------------------------------------
alter table tenants enable row level security;

create policy tenants_select_member
  on tenants
  for select
  to authenticated
  using (is_tenant_member(id));

create policy tenants_update_owner
  on tenants
  for update
  to authenticated
  using (is_tenant_owner(id))
  with check (is_tenant_owner(id));

-- No authenticated INSERT/DELETE policy: creating or deleting a tenant is
-- deliberately deferred to ticket #7 (onboarding) / explicit admin operations
-- via service_role, which bypasses RLS. See header note.

-- ----------------------------------------------------------------------------
-- tenant_memberships RLS
-- ----------------------------------------------------------------------------
alter table tenant_memberships enable row level security;

create policy tenant_memberships_select_member
  on tenant_memberships
  for select
  to authenticated
  using (is_tenant_member(tenant_id));

create policy tenant_memberships_update_owner
  on tenant_memberships
  for update
  to authenticated
  using (is_tenant_owner(tenant_id))
  with check (is_tenant_owner(tenant_id));

create policy tenant_memberships_delete_owner
  on tenant_memberships
  for delete
  to authenticated
  using (is_tenant_owner(tenant_id));

-- No authenticated INSERT policy: the first Owner membership is created as
-- part of tenant onboarding (ticket #7); subsequent memberships are created
-- via the invitation-acceptance flow (ticket #8). Both are out of scope here
-- and both need a service_role / SECURITY DEFINER RPC path anyway, since the
-- inviter/onboarding-user isn't necessarily already a member of the target
-- tenant at insert time.

-- ----------------------------------------------------------------------------
-- "At least one Owner per tenant at all times" -- database-level enforcement
-- ----------------------------------------------------------------------------
create or replace function enforce_tenant_has_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_remaining_owners int;
begin
  v_tenant_id := old.tenant_id;

  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    select count(*) into v_remaining_owners
    from tenant_memberships
    where tenant_id = v_tenant_id
      and role = 'owner';

    if v_remaining_owners = 0 then
      raise exception
        'Tenant % must keep at least one Owner membership; refusing to remove/demote the last Owner.',
        v_tenant_id
        using errcode = 'check_violation';
    end if;
  end if;

  return null; -- ignored, this is an AFTER trigger
end;
$$;

comment on function enforce_tenant_has_owner() is
  'Deferred constraint trigger backing the "every tenant has at least one Owner at all times" invariant. Fires only on UPDATE/DELETE of an existing Owner row (never INSERT, so a tenant''s first membership insert is never blocked) and is evaluated at transaction commit, so a single transaction may swap Owners without tripping it.';

create constraint trigger tenant_memberships_owner_guard
  after update or delete on tenant_memberships
  deferrable initially deferred
  for each row
  execute function enforce_tenant_has_owner();

-- ----------------------------------------------------------------------------
-- brands
-- ----------------------------------------------------------------------------
create table brands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (char_length(name) > 0),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

comment on table brands is
  'A tenant may operate one or more brands (e.g. a group running several restaurant concepts). Tenant-scoped, RLS-protected.';

create trigger brands_set_updated_at
  before update on brands
  for each row
  execute function set_updated_at();

create index brands_tenant_id_idx on brands (tenant_id);

alter table brands enable row level security;

create policy brands_select_member
  on brands
  for select
  to authenticated
  using (is_tenant_member(tenant_id));

create policy brands_insert_owner
  on brands
  for insert
  to authenticated
  with check (is_tenant_owner(tenant_id));

create policy brands_update_owner
  on brands
  for update
  to authenticated
  using (is_tenant_owner(tenant_id))
  with check (is_tenant_owner(tenant_id));

create policy brands_delete_owner
  on brands
  for delete
  to authenticated
  using (is_tenant_owner(tenant_id));

-- ----------------------------------------------------------------------------
-- locations
-- ----------------------------------------------------------------------------
create table locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  brand_id uuid references brands (id) on delete set null,
  name text not null check (char_length(name) > 0),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug)
);

comment on table locations is
  'A physical location belonging to a tenant, optionally attributed to one of its brands. Multi-location management UI is an explicit non-goal of ticket #4 -- this only models the data shape.';

create trigger locations_set_updated_at
  before update on locations
  for each row
  execute function set_updated_at();

create index locations_tenant_id_idx on locations (tenant_id);
create index locations_brand_id_idx on locations (brand_id);

-- Data-integrity guard (not an RLS/tenant-isolation concern): if a location
-- names a brand, that brand must belong to the same tenant as the location.
-- Postgres has no native cross-table check constraint, so this is enforced
-- with a small trigger.
create or replace function enforce_location_brand_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand_tenant_id uuid;
begin
  if new.brand_id is not null then
    select tenant_id into v_brand_tenant_id from brands where id = new.brand_id;

    if v_brand_tenant_id is null or v_brand_tenant_id <> new.tenant_id then
      raise exception
        'location.brand_id must reference a brand belonging to the same tenant_id'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger locations_brand_same_tenant
  before insert or update on locations
  for each row
  execute function enforce_location_brand_same_tenant();

alter table locations enable row level security;

create policy locations_select_member
  on locations
  for select
  to authenticated
  using (is_tenant_member(tenant_id));

create policy locations_insert_owner
  on locations
  for insert
  to authenticated
  with check (is_tenant_owner(tenant_id));

create policy locations_update_owner
  on locations
  for update
  to authenticated
  using (is_tenant_owner(tenant_id))
  with check (is_tenant_owner(tenant_id));

create policy locations_delete_owner
  on locations
  for delete
  to authenticated
  using (is_tenant_owner(tenant_id));
