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
-- updated or deleted from application code. Enforced in multiple
-- independent, redundant layers so a single missing GRANT or future policy
-- change cannot silently reopen the hole:
--   1. GRANTs to `authenticated` and `service_role` include only
--      `select, insert` -- `update`/`delete`/`truncate` are never granted to
--      either role, so Postgres itself rejects any UPDATE/DELETE/TRUNCATE
--      statement before RLS is even evaluated (matches ticket #4's
--      "table-level GRANTs are checked before RLS" note). `truncate` is
--      explicitly REVOKEd below too, since TRUNCATE does not fire
--      row-level triggers and would otherwise silently bypass guard #2.
--   2. A `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger
--      (`audit_logs_immutable`) plus a `BEFORE TRUNCATE ... FOR EACH
--      STATEMENT` trigger (`audit_logs_immutable_truncate`), both executing
--      `reject_audit_log_mutation()`, as defense-in-depth in case a future
--      migration or a `service_role`/superuser connection (which bypasses
--      RLS and could bypass a missing GRANT via `GRANT ALL`) ever re-adds
--      an UPDATE/DELETE/TRUNCATE grant by mistake.
--
-- Opus review cycle 1 finding (fixed here): the naive version of guard #2
-- unconditionally rejected *every* UPDATE/DELETE on audit_logs, including
-- the UPDATE/DELETE statements Postgres itself issues internally to enforce
-- a referencing FK's `on delete` referential action. That silently broke
-- deleting an `auth.users` row (via `actor_user_id`'s `on delete set null`)
-- and deleting a `tenants` row (via `tenant_id`'s `on delete cascade`),
-- reproduced against a real local DB. Fixed by:
--   - `actor_user_id`: kept `on delete set null` (deleting a user must not
--     destroy the historical trail), and `reject_audit_log_mutation()` now
--     distinguishes the caller's role (via `current_setting('role')`, see
--     the function body) rather than rejecting unconditionally: for an
--     app-facing role (`authenticated`/`anon`/`service_role`), the *only*
--     UPDATE ever permitted is exactly that one shape (nulling a previously
--     non-null `actor_user_id`, with every other column byte-for-byte
--     unchanged) -- anything else from an app-facing role is still
--     rejected. A direct superuser/migration/ops connection (no app-facing
--     role set) is not restricted by the UPDATE guard at all, matching this
--     table's "explicit, separate, privileged" maintenance-path design
--     (see `tenant_id` below).
--   - `tenant_id`: changed from `on delete cascade` to `on delete restrict`.
--     A tenant that still has audit history can never be deleted at all
--     (Postgres rejects the DELETE with an FK-violation error, before the
--     trigger is even reached) -- deleting a tenant's audit trail is a
--     separate, explicit, privileged purge/archive operation, not an
--     implicit side effect of deleting the tenant. That privileged purge is
--     literally "connect directly as a DB role that isn't `authenticated`/
--     `anon`/`service_role` (e.g. a superuser/migration/ops connection) and
--     run the DELETE" -- `reject_audit_log_mutation()` only blocks DELETE/
--     TRUNCATE for the three app-facing roles, never for such a connection.
--     A tenant with zero audit rows deletes normally (no referencing rows,
--     no FK conflict). This is why
--     `packages/testing/src/tenant-fixture.ts`'s `cleanup()` now deletes
--     each fixture tenant's `audit_logs` rows (via its RLS-bypassing admin
--     connection) before deleting the tenants themselves.
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
--   drop trigger if exists audit_logs_immutable_truncate on audit_logs;
--   drop trigger if exists audit_logs_immutable on audit_logs;
--   drop function if exists reject_audit_log_mutation();
--   drop table if exists audit_logs;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- audit_logs
-- ----------------------------------------------------------------------------
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  -- `on delete restrict` (not cascade): a tenant with existing audit history
  -- can never be deleted implicitly. Deleting/anonymizing a tenant's audit
  -- trail is a separate, explicit, privileged operation -- see the
  -- migration header's "Opus review cycle 1 finding" note.
  tenant_id uuid not null references tenants (id) on delete restrict,
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
declare
  -- `current_setting('role')` reflects the role a caller switched to via
  -- `SET ROLE`/`SET LOCAL ROLE` (what PostgREST does per-request for
  -- `authenticated`/`anon`/`service_role`, and what this migration's own
  -- RLS policies key off), regardless of this function's SECURITY DEFINER
  -- context -- unlike `current_user`/`session_user`, which SECURITY
  -- DEFINER and `SET ROLE` respectively do NOT let us use to see "which
  -- app-facing role actually issued this statement". It reads as the
  -- literal string 'none' when no `SET ROLE` is in effect for the session
  -- at all, e.g. a direct superuser/migration/ops connection -- which is
  -- exactly the "explicit, separate, privileged purge path" this design
  -- reserves for deleting audit history (see the tenant_id `on delete
  -- restrict` note in the migration header): never reachable from an app
  -- request, only from someone connecting directly as a privileged DB role.
  caller_role text := current_setting('role', true);
  is_app_facing_role boolean := caller_role in ('authenticated', 'anon', 'service_role');
begin
  -- TRUNCATE fires this as a FOR EACH STATEMENT trigger -- there is no
  -- OLD/NEW row to inspect, and none is needed here.
  if tg_op = 'TRUNCATE' then
    if is_app_facing_role then
      raise exception
        'audit_logs is append-only: TRUNCATE is never permitted for %.', caller_role
        using errcode = 'insufficient_privilege';
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    if is_app_facing_role then
      raise exception
        'audit_logs is append-only: DELETE is never permitted for %. Use an explicit, separate, privileged purge (a direct superuser/migration connection, not an app-facing role) if a tenant''s audit history must be removed before that tenant can be deleted (tenant_id is `on delete restrict`).',
        caller_role
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  -- tg_op = 'UPDATE'. For an app-facing role, the *only* mutation ever
  -- permitted is the exact UPDATE Postgres issues internally for
  -- actor_user_id's `on delete set null` referential action (fired when a
  -- referenced auth.users row is deleted): nulling a previously non-null
  -- actor_user_id, with every other column byte-for-byte unchanged.
  -- Anything else, from an app-facing role, is rejected. A non-app-facing
  -- (privileged) caller is not restricted here -- the privileged purge path
  -- is scoped to DELETE/TRUNCATE above; arbitrary UPDATEs by a direct
  -- superuser/ops connection are an operational matter outside this
  -- guard's scope, not something this ticket needs to additionally police.
  if not is_app_facing_role then
    return new;
  end if;

  if new.actor_user_id is null
     and old.actor_user_id is not null
     and new.id = old.id
     and new.tenant_id = old.tenant_id
     and new.action = old.action
     and new.target_type = old.target_type
     and new.target_id is not distinct from old.target_id
     and new.metadata = old.metadata
     and new.correlation_id = old.correlation_id
     and new.created_at = old.created_at
  then
    return new;
  end if;

  raise exception
    'audit_logs is append-only: UPDATE is only permitted for % to null actor_user_id via the auth.users deletion referential action; no other mutation is allowed.',
    caller_role
    using errcode = 'insufficient_privilege';
end;
$$;

comment on function reject_audit_log_mutation() is
  'Rejects TRUNCATE/DELETE on audit_logs for app-facing roles (authenticated/anon/service_role), and UPDATE for those roles unless it is exactly the actor_user_id on delete set null referential action -- as defense-in-depth alongside the table''s GRANTs (which never include update/delete/truncate for those roles). A non-app-facing caller (a direct superuser/migration/ops connection, detected via current_setting(''role'') = ''none'') is treated as the table''s documented "explicit, separate, privileged purge path" and is not blocked by this trigger -- see the tenant_id `on delete restrict` note in the migration header. search_path = '''' for consistency with the other SECURITY DEFINER helpers in this migration set.';

create trigger audit_logs_immutable
  before update or delete on audit_logs
  for each row
  execute function reject_audit_log_mutation();

-- TRUNCATE does not fire row-level triggers (or evaluate GRANTs the same
-- way an UPDATE/DELETE would necessarily be caught by the ones above) --
-- this statement-level trigger is what actually stops
-- `truncate table audit_logs`. See also the `revoke truncate` below.
create trigger audit_logs_immutable_truncate
  before truncate on audit_logs
  for each statement
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

-- `truncate` is deliberately never granted above, and is explicitly
-- revoked here too (Postgres has, in the past, been inconsistent about
-- what a role implicitly gets without an explicit REVOKE, and this closes
-- that ambiguity for good against a table already handling immutable
-- history). TRUNCATE does not fire row-level triggers, so the GRANT
-- restriction and the guard trigger above are not by themselves sufficient
-- -- this REVOKE plus the `audit_logs_immutable_truncate` statement-level
-- trigger are both required (defense-in-depth, same rationale as the rest
-- of this immutability design). `analytics_events`' own `revoke truncate`
-- is issued in its own section below, once that table exists.
revoke truncate on audit_logs from anon, authenticated, service_role;

-- Tenant members may append audit entries for their own tenant only. Every
-- write must go through recordAuditEvent(), which resolves tenant_id from
-- the caller's authenticated session/membership server-side (never a raw
-- client-supplied value) before this INSERT is attempted -- this policy is
-- the DB-level backstop, not the primary authorization check.
--
-- `actor_user_id is null or actor_user_id = auth.uid()`: prevents a tenant
-- member from forging another user as the actor of an audit entry (e.g.
-- framing a coworker). This DB-level check cannot, by itself, prevent a
-- tenant member from bypassing recordAuditEvent() entirely via a direct
-- INSERT and writing unvalidated/secret-shaped `metadata` -- that
-- content-level validation is deliberately an application-layer-only
-- guarantee (recordAuditEvent()'s assertSafeAuditMetadata()), which is why
-- direct INSERT access to this table should stay minimized to trusted
-- server-side paths (tracked as a residual gap for a later, more
-- restrictive-access ticket, not this one).
create policy audit_logs_insert_member
  on audit_logs
  for insert
  to authenticated
  with check (
    is_tenant_member(tenant_id)
    and (actor_user_id is null or actor_user_id = auth.uid())
  );

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

-- Same rationale as audit_logs' `revoke truncate` above: least-privilege,
-- and TRUNCATE doesn't fire row-level triggers so it must be closed off at
-- the GRANT layer explicitly rather than relying on any future trigger.
revoke truncate on analytics_events from anon, authenticated, service_role;

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
