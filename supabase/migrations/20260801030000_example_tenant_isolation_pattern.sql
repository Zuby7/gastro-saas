-- ============================================================================
-- REFERENCE / EXAMPLE MIGRATION -- tenant isolation pattern (ticket #3)
-- ============================================================================
-- This migration is NOT a real domain table and ships no real product data.
-- It exists purely as a copy-paste reference for future tickets (#4 onward)
-- that create real tenant-scoped tables, demonstrating the mandatory pattern
-- from docs/security/tenant-isolation.md and .claude/rules/database-migrations.md:
--
--   - every tenant-scoped table has an explicit `tenant_id` column
--   - the RLS policy ships in the SAME migration as the table it protects
--   - tenant context is resolved from the caller's authenticated membership,
--     never trusted from a client-supplied tenant_id
--   - RLS is the Layer-2 backstop, not the only layer -- application code
--     still resolves tenant_id server-side before any query reaches here
--
-- Scope note (Layer 0 / guest paths): this pattern covers Layer 1 + Layer 2
-- for AUTHENTICATED, membership-based access. It does NOT cover Layer 0
-- (guest/unauthenticated writes: cart, order, rating -- see
-- docs/security/tenant-isolation.md "Layer 0"). Guest-facing tables must NOT
-- copy this "auth.uid() -> membership" policy shape: guest writes are
-- performed by a server-side handler using a scoped service role (which
-- bypasses RLS by design) after resolving tenant_id from the public route
-- slug server-side, and guest reads are scoped by a single-purpose,
-- high-entropy token checked against the specific row, not by tenant
-- membership. Read that doc's Layer 0 section before reusing this file as a
-- template for any guest-facing table.
--
-- The real `tenants` table and membership model are introduced in ticket #4
-- (data model) and ticket #7 (auth) respectively. This migration creates
-- minimal, clearly-marked stand-ins so the example is runnable in isolation
-- and does not collide with the real schema when those tickets land.
--
-- Rollback: this migration is self-contained and purely additive (three new
-- tables, no shared/domain schema touched), so local rollback is either
-- `supabase db reset` (replays all migrations up to but excluding this one
-- once it's deleted) or the explicit down-statements a maintainer can run by
-- hand:
--   drop table if exists example_tenant_notes;
--   drop table if exists example_tenant_memberships;
--   drop table if exists example_tenants;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Minimal stand-in tenants table (superseded by the real one in ticket #4+)
-- ----------------------------------------------------------------------------
create table if not exists example_tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

comment on table example_tenants is
  'Reference/example only (ticket #3) -- superseded by the real tenants table in ticket #4+. Not a real domain table; safe to drop.';

-- ----------------------------------------------------------------------------
-- Minimal stand-in membership table: which auth user belongs to which tenant
-- (superseded by the real membership model in ticket #7 -- auth)
-- ----------------------------------------------------------------------------
create table if not exists example_tenant_memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references example_tenants (id) on delete cascade,
  primary key (user_id, tenant_id)
);

comment on table example_tenant_memberships is
  'Reference/example only (ticket #3) -- superseded by the real membership model in ticket #7. Not a real domain table; safe to drop.';

alter table example_tenant_memberships enable row level security;

-- A user may only see their own membership rows -- never enumerate who else
-- belongs to a tenant via this table.
create policy "example_tenant_memberships_select_own"
  on example_tenant_memberships
  for select
  to authenticated
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- The actual reference pattern: a tenant-scoped table with RLS in the same
-- migration. Copy this shape for real tenant-scoped tables in later tickets.
-- ----------------------------------------------------------------------------
create table if not exists example_tenant_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references example_tenants (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

comment on table example_tenant_notes is
  'Reference/example only (ticket #3) -- demonstrates the mandatory tenant_id + RLS pattern for future tenant-scoped tables. Not a real domain table; safe to drop.';

alter table example_tenant_notes enable row level security;

-- Deny-by-default: enabling RLS with no policy means no role (other than the
-- table owner / service_role, which bypasses RLS) can see any row. The
-- policies below explicitly opt the `authenticated` role back in, scoped to
-- rows belonging to a tenant the caller actually has a membership row for --
-- never to a client-supplied tenant_id.

create policy "example_tenant_notes_select_own_tenant"
  on example_tenant_notes
  for select
  to authenticated
  using (
    tenant_id in (
      select tenant_id from example_tenant_memberships where user_id = auth.uid()
    )
  );

create policy "example_tenant_notes_insert_own_tenant"
  on example_tenant_notes
  for insert
  to authenticated
  with check (
    tenant_id in (
      select tenant_id from example_tenant_memberships where user_id = auth.uid()
    )
  );

create policy "example_tenant_notes_update_own_tenant"
  on example_tenant_notes
  for update
  to authenticated
  using (
    tenant_id in (
      select tenant_id from example_tenant_memberships where user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select tenant_id from example_tenant_memberships where user_id = auth.uid()
    )
  );

create policy "example_tenant_notes_delete_own_tenant"
  on example_tenant_notes
  for delete
  to authenticated
  using (
    tenant_id in (
      select tenant_id from example_tenant_memberships where user_id = auth.uid()
    )
  );
