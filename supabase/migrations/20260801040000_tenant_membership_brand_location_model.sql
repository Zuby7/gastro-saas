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
-- Enforced at the database level via two DEFERRABLE INITIALLY DEFERRED
-- constraint triggers, both evaluated at transaction commit:
--   1. `tenant_memberships_owner_guard` on `tenant_memberships`, firing on
--      DELETE of an Owner row, on UPDATE that changes an Owner's role away
--      from 'owner', and on UPDATE that re-parents an Owner row to a
--      different tenant_id (`old.tenant_id <> new.tenant_id`) -- all three
--      can otherwise silently strip a tenant's last Owner.
--   2. `tenants_created_with_owner` on `tenants`, firing AFTER INSERT,
--      asserting at commit that the newly created tenant has at least one
--      Owner membership. This closes the gap trigger (1) cannot see: a bare
--      `insert into tenants(...)` with zero memberships. Ticket #7's
--      onboarding flow must still insert the tenant and its first Owner
--      membership atomically in one transaction/RPC -- the DB now *enforces*
--      that requirement rather than merely relying on it.
-- Because both checks are deferred to commit, a single transaction that
-- removes one Owner while adding/promoting another Owner (or that inserts a
-- tenant followed by its first Owner membership) in the same transaction is
-- still allowed.
--
-- Interaction with `auth.users` deletion: because `tenant_memberships.user_id`
-- references `auth.users(id) on delete cascade`, deleting the sole Owner's
-- `auth.users` row cascades into deleting their `tenant_memberships` row,
-- which trips `tenant_memberships_owner_guard` at commit and aborts the
-- entire `DELETE` if no other Owner exists for that tenant. This is
-- intentional and is an explicit prerequisite for future onboarding/
-- account-deletion tickets: an ownership transfer (promote another member to
-- Owner) or a full tenant deletion must precede deleting a sole Owner's user
-- account.
--
-- Rollback: additive-only versus the previous migration (drops three
-- example-only tables, creates four real ones + helper functions/triggers).
-- Down-migration a maintainer can run by hand against a local/throwaway DB:
--   drop table if exists locations;
--   drop table if exists brands;
--   drop trigger if exists tenants_created_with_owner on tenants;
--   drop function if exists enforce_tenant_has_owner_on_create();
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
set search_path = ''
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
--
-- `set search_path = ''` (not `public`) is deliberate and load-bearing:
-- Postgres always searches `pg_temp` first for unqualified relation names,
-- even when `pg_temp` isn't listed in `search_path`, and Supabase grants TEMP
-- on the database to PUBLIC by default. Any authenticated session could
-- otherwise run `create temp table tenant_memberships (...)` to shadow the
-- real table inside a SECURITY DEFINER function, making it return
-- attacker-controlled results -- a full cross-tenant RLS bypass. With
-- `search_path = ''` there is no schema to resolve an unqualified name
-- against, so every reference below is fully schema-qualified instead.
-- ----------------------------------------------------------------------------
create or replace function is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.tenant_memberships
    where tenant_id = p_tenant_id
      and user_id = auth.uid()
  );
$$;

comment on function is_tenant_member(uuid) is
  'True if the currently authenticated user (auth.uid()) has any membership row for the given tenant. SECURITY DEFINER to avoid RLS self-recursion on tenant_memberships. search_path = '''' + schema-qualified refs to prevent pg_temp table-shadowing bypass.';

create or replace function is_tenant_owner(p_tenant_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.tenant_memberships
    where tenant_id = p_tenant_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

comment on function is_tenant_owner(uuid) is
  'True if the currently authenticated user (auth.uid()) has an Owner membership for the given tenant. SECURITY DEFINER to avoid RLS self-recursion on tenant_memberships. search_path = '''' + schema-qualified refs to prevent pg_temp table-shadowing bypass.';

revoke all on function is_tenant_member(uuid) from public;
revoke all on function is_tenant_owner(uuid) from public;
grant execute on function is_tenant_member(uuid) to authenticated, service_role;
grant execute on function is_tenant_owner(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- tenants RLS
-- ----------------------------------------------------------------------------
alter table tenants enable row level security;

-- Postgres checks table-level GRANTs *before* RLS -- RLS alone does not
-- expose a table to a role, it only filters rows once access is otherwise
-- permitted. New tables are not auto-exposed to the Data API roles by
-- default (see supabase/config.toml `[api] auto_expose_new_tables` note), so
-- every RLS-protected table below needs an explicit GRANT matching the verbs
-- its policies allow. `service_role` bypasses RLS entirely but still needs
-- the same underlying GRANTs to read/write at all.
grant select, update on tenants to authenticated;
grant select, insert, update, delete on tenants to service_role;

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

-- Column-level UPDATE grant only: authenticated Owners may change a
-- membership's `role`, but must never be able to rewrite `user_id` on an
-- existing row (that would let an Owner add an arbitrary user to the tenant,
-- bypassing the invitation flow entirely) or re-parent `tenant_id` freely
-- through anything other than the guarded path below.
grant select, delete on tenant_memberships to authenticated;
grant update (role) on tenant_memberships to authenticated;
grant select, insert, update, delete on tenant_memberships to service_role;

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
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_remaining_owners int;
begin
  v_tenant_id := old.tenant_id;

  if (tg_op = 'DELETE' and old.role = 'owner')
     or (
       tg_op = 'UPDATE'
       and old.role = 'owner'
       and (new.role <> 'owner' or new.tenant_id <> old.tenant_id)
     ) then
    -- If the (source) tenant itself no longer exists (e.g. `delete from
    -- tenants ...` cascaded into deleting all of its memberships in the same
    -- transaction), there is nothing to protect -- skip the check so
    -- deleting a whole tenant is never blocked by its own Owner cleanup.
    if not exists (select 1 from public.tenants where id = v_tenant_id) then
      return null;
    end if;

    select count(*) into v_remaining_owners
    from public.tenant_memberships
    where tenant_id = v_tenant_id
      and role = 'owner';

    if v_remaining_owners = 0 then
      raise exception
        'Tenant % must keep at least one Owner membership; refusing to remove/demote/re-parent the last Owner.',
        v_tenant_id
        using errcode = 'check_violation';
    end if;
  end if;

  return null; -- ignored, this is an AFTER trigger
end;
$$;

comment on function enforce_tenant_has_owner() is
  'Deferred constraint trigger backing the "every tenant has at least one Owner at all times" invariant. Fires on DELETE of an Owner row, on UPDATE demoting an Owner away from role = owner, and on UPDATE re-parenting an Owner row to a different tenant_id (never on INSERT, so a tenant''s first membership insert is never blocked). Evaluated at transaction commit, so a single transaction may swap Owners without tripping it. search_path = '''' + schema-qualified refs to prevent pg_temp table-shadowing bypass.';

create constraint trigger tenant_memberships_owner_guard
  after update or delete on tenant_memberships
  deferrable initially deferred
  for each row
  execute function enforce_tenant_has_owner();

-- ----------------------------------------------------------------------------
-- "At least one Owner at all times", part 2: a tenant created with zero
-- memberships at all (the trigger above lives on tenant_memberships, so it
-- can never observe that case).
-- ----------------------------------------------------------------------------
create or replace function enforce_tenant_has_owner_on_create()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_count int;
begin
  select count(*) into v_owner_count
  from public.tenant_memberships
  where tenant_id = new.id
    and role = 'owner';

  if v_owner_count = 0 then
    raise exception
      'Tenant % must be created together with at least one Owner membership in the same transaction.',
      new.id
      using errcode = 'check_violation';
  end if;

  return null; -- ignored, this is an AFTER trigger
end;
$$;

comment on function enforce_tenant_has_owner_on_create() is
  'Deferred constraint trigger requiring a newly inserted tenant to have at least one Owner membership by commit time. Ticket #7''s onboarding flow must insert the tenant and its first Owner membership atomically in one transaction/RPC; this trigger enforces that at the database level rather than relying on it. search_path = '''' + schema-qualified refs to prevent pg_temp table-shadowing bypass.';

create constraint trigger tenants_created_with_owner
  after insert on tenants
  deferrable initially deferred
  for each row
  execute function enforce_tenant_has_owner_on_create();

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

grant select, insert, update, delete on brands to authenticated;
grant select, insert, update, delete on brands to service_role;

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
set search_path = ''
as $$
declare
  v_brand_tenant_id uuid;
begin
  if new.brand_id is not null then
    select tenant_id into v_brand_tenant_id from public.brands where id = new.brand_id;

    if v_brand_tenant_id is null or v_brand_tenant_id <> new.tenant_id then
      raise exception
        'location.brand_id must reference a brand belonging to the same tenant_id'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function enforce_location_brand_same_tenant() is
  'Data-integrity guard ensuring location.brand_id (if set) belongs to the same tenant_id as the location. search_path = '''' + schema-qualified refs to prevent pg_temp table-shadowing bypass.';

create trigger locations_brand_same_tenant
  before insert or update on locations
  for each row
  execute function enforce_location_brand_same_tenant();

alter table locations enable row level security;

grant select, insert, update, delete on locations to authenticated;
grant select, insert, update, delete on locations to service_role;

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
