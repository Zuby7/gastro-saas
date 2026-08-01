-- ============================================================================
-- Audit log + analytics_events skeleton (ticket #6)
-- ============================================================================
-- Introduces `audit_logs` (write-only append log for sensitive/security-
-- relevant actions, see packages/domain/src/audit and
-- docs/data/domain-model.md "Audit") and a bare-bones `analytics_events`
-- table (no aggregation/analytics logic -- that's Epic 9's scope; this only
-- exists so later tickets don't have to write against a missing table, per
-- the Opus architecture review that pulled this table forward into #6).
--
-- Follows the tenant_id + RLS + SECURITY DEFINER helper pattern established
-- by ticket #4's migration
-- (supabase/migrations/20260801040000_tenant_membership_brand_location_model.sql,
-- Opus-APPROVED), reusing its `is_tenant_member(uuid)` helper rather than
-- redefining an equivalent function. That helper is already SECURITY DEFINER
-- with `search_path = ''` and fully schema-qualified references, closing the
-- pg_temp-shadowing bypass ticket #4's cycle-1 Opus review found -- nothing
-- new to harden here since no new SECURITY DEFINER helper is introduced by
-- this migration for that purpose (see below for the two "immutability
-- guard" trigger functions, which are also hardened the same way).
--
-- Immutability (acceptance criterion): `audit_logs` rows may never be
-- updated or deleted from application code. Enforced in two independent,
-- redundant layers so a single missing GRANT or future policy change cannot
-- silently reopen the hole:
--   1. GRANTs to `authenticated` and `service_role` include only
--      `select, insert` -- `update`/`delete` are never granted to either
--      role, so Postgres itself rejects any UPDATE/DELETE statement before
--      RLS is even evaluated (matches ticket #4's "table-level GRANTs are
--      checked before RLS" note).
--   2. A `BEFORE UPDATE OR DELETE` trigger (`audit_logs_immutable`) that
--      unconditionally raises an exception, as defense-in-depth in case a
--      future migration or a `service_role`/superuser connection (which
--      bypasses RLS and could bypass a missing GRANT via `GRANT ALL`) ever
--      re-adds an UPDATE/DELETE grant by mistake.
--
-- `analytics_events` is a plain tenant-scoped table (select/insert only from
-- `authenticated`, matching the "event log, not a mutable resource" shape)
-- with no FK to `dishes`/`orders` yet, since those tables don't exist before
-- Epic 4/6 -- the `dish_id`/`order_id` columns are plain nullable uuid
-- columns for now, to be given FK constraints once those tables land.
--
-- Rollback: additive-only. Down-migration a maintainer can run by hand
-- against a local/throwaway DB:
--   drop table if exists analytics_events;
--   drop trigger if exists audit_logs_immutable on audit_logs;
--   drop function if exists reject_audit_log_mutation();
--   drop table if exists audit_logs;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- audit_logs
-- ----------------------------------------------------------------------------
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- The user who performed the action. `on delete set null` (not cascade):
  -- deleting a user account must never destroy the historical audit trail
  -- of what that user did.
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(action) > 0 and char_length(action) <= 200),
  target_type text not null check (char_length(target_type) > 0 and char_length(target_type) <= 100),
  target_id text check (target_id is null or char_length(target_id) > 0),
  -- Safe (non-secret) structured context about the action. Application code
  -- must go through recordAuditEvent() (packages/domain/src/audit), which
  -- validates and rejects secret-/payment-shaped values *before* this insert
  -- ever runs -- this column has no DB-level content check, since that
  -- validation is deliberately owned by the application layer's write
  -- function, not duplicated here.
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

comment on table audit_logs is
  'Append-only audit trail of security-relevant actions. Tenant-scoped, RLS-protected, immutable (no UPDATE/DELETE from application code -- see audit_logs_immutable trigger and the table''s GRANTs). Written exclusively through recordAuditEvent() in packages/domain/src/audit, which rejects secret-/payment-shaped metadata before it ever reaches this table. See docs/data/domain-model.md "Audit" and docs/security/threat-model.md.';

comment on column audit_logs.metadata is
  'Safe, non-secret structured context, validated and secret-scanned by recordAuditEvent() before insert. Never store passwords, tokens, API keys, card numbers, or other credential-shaped values here.';

comment on column audit_logs.correlation_id is
  'Groups audit entries that belong to the same logical request/operation (see .claude/rules/backend-api.md''s request correlation ID requirement). Defaults to a fresh UUID per entry when the caller does not supply one.';

create index audit_logs_tenant_id_idx on audit_logs (tenant_id);
create index audit_logs_tenant_id_created_at_idx on audit_logs (tenant_id, created_at desc);
create index audit_logs_correlation_id_idx on audit_logs (correlation_id);
create index audit_logs_actor_user_id_idx on audit_logs (actor_user_id);

-- ----------------------------------------------------------------------------
-- audit_logs: immutability guard (defense-in-depth alongside the GRANTs below)
-- ----------------------------------------------------------------------------
create or replace function reject_audit_log_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception
    'audit_logs is append-only: UPDATE and DELETE are never permitted, even from privileged connections.'
    using errcode = 'insufficient_privilege';
end;
$$;

comment on function reject_audit_log_mutation() is
  'Unconditionally rejects UPDATE/DELETE on audit_logs, as defense-in-depth alongside the table''s GRANTs (which never include update/delete for any role). search_path = '''' + no table references needed, but kept schema-empty for consistency with the other SECURITY DEFINER helpers in this migration set.';

create trigger audit_logs_immutable
  before update or delete on audit_logs
  for each row
  execute function reject_audit_log_mutation();

-- ----------------------------------------------------------------------------
-- audit_logs RLS
-- ----------------------------------------------------------------------------
alter table audit_logs enable row level security;

-- No `update`/`delete` in either GRANT -- see the immutability note above.
-- No `select` for `authenticated` yet: the `audit.read` permission
-- (docs/data/domain-model.md "Authorization") is defined by this ticket but
-- deliberately not enforced/used anywhere yet (no read function exists) --
-- see ticket #6's scope note. Granting `select` here without an accompanying
-- read function and permission check would be premature exposure of every
-- tenant member to arbitrary audit reads before the access-control ticket
-- that's actually supposed to gate it.
grant insert on audit_logs to authenticated;
grant select, insert on audit_logs to service_role;

-- Tenant members may append audit entries for their own tenant only. Every
-- write must go through recordAuditEvent(), which resolves tenant_id from
-- the caller's authenticated session/membership server-side (never a raw
-- client-supplied value) before this INSERT is attempted -- this policy is
-- the DB-level backstop, not the primary authorization check.
create policy audit_logs_insert_member
  on audit_logs
  for insert
  to authenticated
  with check (is_tenant_member(tenant_id));

-- ----------------------------------------------------------------------------
-- analytics_events (Grundgerüst -- no aggregation/analytics logic, Epic 9)
-- ----------------------------------------------------------------------------
create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  event_type text not null check (char_length(event_type) > 0 and char_length(event_type) <= 100),
  -- Plain (non-FK) references: `dishes` (Epic 4) and `orders` (Epic 6) don't
  -- exist yet. Add proper foreign keys once those tables land -- tracked as
  -- a follow-up, not this ticket's scope.
  dish_id uuid,
  order_id uuid,
  created_at timestamptz not null default now()
);

comment on table analytics_events is
  'Skeleton for per-event analytics facts (Epic 9 owns the aggregation/reporting logic). Tenant-scoped, RLS-protected. dish_id/order_id are plain uuid columns without FK constraints until the dishes (Epic 4) and orders (Epic 6) tables exist.';

create index analytics_events_tenant_id_idx on analytics_events (tenant_id);
create index analytics_events_tenant_id_created_at_idx on analytics_events (tenant_id, created_at desc);

alter table analytics_events enable row level security;

-- No update/delete grants: like audit_logs, this is an append-only event
-- log by nature, even though ticket #6 does not require a hard immutability
-- guarantee here (that's explicitly only an audit_logs acceptance
-- criterion) -- least-privilege default until Epic 9 defines real needs.
grant select, insert on analytics_events to authenticated;
grant select, insert on analytics_events to service_role;

create policy analytics_events_select_member
  on analytics_events
  for select
  to authenticated
  using (is_tenant_member(tenant_id));

create policy analytics_events_insert_member
  on analytics_events
  for insert
  to authenticated
  with check (is_tenant_member(tenant_id));
