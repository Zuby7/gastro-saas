-- ============================================================================
-- Provider-neutral integration foundation + mock provider (Epic 12, ticket #38)
-- ============================================================================
-- Adds the tenant-scoped `integration_accounts` / `integration_sync_jobs` /
-- `integration_errors` tables and the `integrations.manage`-gated write/read
-- RPCs the mock provider (apps/web/src/lib/integrations,
-- packages/domain/src/integrations) uses to demonstrate a menu export and a
-- simulated incoming order/confirmation -- this ticket's only two acceptance
-- criteria. No real Lieferando/Wolt/Uber-Eats/POS adapter exists yet (see
-- this ticket's explicit non-goals); ticket #39's retry/reconciliation work
-- is out of scope until a real provider exists.
--
-- Design:
--   - `integration_accounts`: one row per tenant per provider ("mock" is the
--     only `provider_key` accepted today). `status` is 'mock' (default,
--     working as intended for the mock provider), 'connected' (reserved for
--     a real provider, never set by this ticket), or 'error' (last recorded
--     sync job failed) -- exactly the three states the ticket's "UI-Zustände"
--     note calls for.
--   - `integration_sync_jobs`: append-only log of every export/sync/import/
--     confirmation attempt, one row per attempt, recording its outcome. The
--     mock provider always runs synchronously, so a job is inserted already
--     in its terminal state ('succeeded'/'failed') -- there is no
--     'pending'/async row ticket #39's retry machinery would later need.
--   - `integration_errors`: one row per *failed* sync job, so a future
--     reconciliation ticket has a dedicated error queue to work from instead
--     of filtering `integration_sync_jobs` by status.
--
-- Two enforcement layers throughout, matching this repo's standard: callers
-- (apps/web/src/lib/integrations/service.ts) call
-- `requireTenantPermission(..., 'integrations.manage')` before invoking any
-- RPC below, and every RPC independently re-checks the same permission via
-- `require_tenant_permission()`. Reads are additionally backstopped by an
-- `integrations.manage`-gated RLS SELECT policy on all three tables; there is
-- no direct INSERT/UPDATE/DELETE grant to `authenticated` at all -- every
-- write goes exclusively through the SECURITY DEFINER RPCs below, mirroring
-- `moderate_rating()`'s precedent (20260819100000_rating_moderation_queue.sql).
--
-- Observability (ticket's own "Sync-Vorgänge auditiert" note):
-- `record_integration_sync_job()` appends an `audit_logs` row for every job
-- it records, directly in the RPC body (auth.uid() is available here since
-- the RPC always runs on behalf of an authenticated tenant member) -- same
-- pattern as `moderate_rating()`'s own inline `has_tenant_permission`/
-- `auth.uid()` usage, just inlined rather than via an AFTER trigger since
-- there is exactly one write path into `integration_sync_jobs`.
--
-- Permission scoping: Owner gets `integrations.manage` automatically (full
-- catalog). Manager gets it too -- same operational-management tier as
-- `payments.connect`/`reviews.moderate`. Kitchen/Service/Marketing get
-- neither; none of those roles has a reason to configure integrations.
--
-- Rollback for local/throwaway DBs:
--   revoke all on function record_integration_sync_job(uuid, uuid, text, text, jsonb, text) from authenticated, service_role;
--   drop function if exists record_integration_sync_job(uuid, uuid, text, text, jsonb, text);
--   revoke all on function list_integration_sync_jobs(uuid, uuid) from authenticated, service_role;
--   drop function if exists list_integration_sync_jobs(uuid, uuid);
--   revoke all on function list_integration_accounts(uuid) from authenticated, service_role;
--   drop function if exists list_integration_accounts(uuid);
--   revoke all on function create_integration_account(uuid, text, text) from authenticated, service_role;
--   drop function if exists create_integration_account(uuid, text, text);
--   drop table if exists integration_errors;
--   drop table if exists integration_sync_jobs;
--   drop table if exists integration_accounts;
--   delete from role_permissions where permission_key = 'integrations.manage';
--   delete from permissions where key = 'integrations.manage';
-- ============================================================================

insert into permissions (key, description)
values ('integrations.manage', 'Configure integration accounts and trigger/inspect sync jobs (mock provider today)')
on conflict (key) do update set description = excluded.description;

-- Backfill for tenants that already exist at migration-apply time, same
-- pattern as every prior permission-introducing migration.
insert into role_permissions (role_id, permission_key)
select r.id, p.key
  from roles r
 cross join permissions p
 where r.key = 'owner'
   and p.key = 'integrations.manage'
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, grants.permission_key
  from roles r
  join (
    values
      ('manager', 'integrations.manage')
  ) as grants(role_key, permission_key) on grants.role_key = r.key
on conflict do nothing;

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
    (v_manager_role_id, 'menu.read'),
    (v_manager_role_id, 'menu.availability.manage'),
    (v_manager_role_id, 'orders.cancel'),
    (v_manager_role_id, 'orders.read'),
    (v_manager_role_id, 'orders.manage'),
    (v_manager_role_id, 'payments.refund'),
    (v_manager_role_id, 'payments.read'),
    (v_manager_role_id, 'analytics.read'),
    (v_manager_role_id, 'audit.read'),
    (v_manager_role_id, 'reviews.read'),
    (v_manager_role_id, 'reviews.moderate'),
    (v_manager_role_id, 'integrations.manage'),
    (v_kitchen_role_id, 'menu.read'),
    (v_kitchen_role_id, 'menu.availability.manage'),
    (v_kitchen_role_id, 'orders.cancel'),
    (v_kitchen_role_id, 'orders.read'),
    (v_kitchen_role_id, 'orders.manage'),
    (v_service_role_id, 'menu.read'),
    (v_service_role_id, 'menu.availability.manage'),
    (v_service_role_id, 'orders.cancel'),
    (v_service_role_id, 'orders.read'),
    (v_service_role_id, 'orders.manage'),
    (v_marketing_role_id, 'menu.publish'),
    (v_marketing_role_id, 'menu.read'),
    (v_marketing_role_id, 'analytics.read')
  on conflict do nothing;

  return new;
end;
$$;

comment on function seed_standard_roles_for_tenant() is
  'Creates the Owner/Manager/Kitchen/Service/Marketing system roles for a tenant and attaches their default permissions.';

-- ----------------------------------------------------------------------------
-- integration_accounts -- one row per tenant per provider (only 'mock' today).
-- ----------------------------------------------------------------------------
create table integration_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  provider_key text not null check (provider_key in ('mock')),
  label text not null,
  status text not null default 'mock' check (status in ('mock', 'connected', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider_key)
);

comment on table integration_accounts is
  'Ticket #38: one row per tenant per integration provider. provider_key is constrained to ''mock'' today -- no real Lieferando/Wolt/Uber-Eats/POS adapter exists (explicit non-goal). status reflects the outcome of the most recently recorded sync job: ''mock'' (default/healthy), ''error'' (last job failed).';

create index integration_accounts_tenant_id_idx on integration_accounts (tenant_id);

create trigger integration_accounts_set_updated_at
  before update on integration_accounts
  for each row
  execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- integration_sync_jobs -- append-only log of every export/sync/import/
-- confirmation attempt.
-- ----------------------------------------------------------------------------
create table integration_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  integration_account_id uuid not null references integration_accounts (id) on delete cascade,
  job_type text not null check (job_type in ('menu_export', 'availability_sync', 'order_import', 'order_confirmation')),
  status text not null check (status in ('succeeded', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table integration_sync_jobs is
  'Ticket #38: append-only record of one export/sync/import/confirmation attempt against an integration_accounts row. The mock provider always runs synchronously, so every row is inserted already in its terminal status (succeeded/failed) -- there is no pending/async row for ticket #39''s future retry machinery to pick up yet, since no real (non-instant) provider exists.';

create index integration_sync_jobs_tenant_id_idx on integration_sync_jobs (tenant_id);
create index integration_sync_jobs_tenant_id_created_at_idx on integration_sync_jobs (tenant_id, created_at desc);
create index integration_sync_jobs_account_id_idx on integration_sync_jobs (integration_account_id);

-- Same-tenant integrity guard, mirroring ensure_rating_moderation_tenant_match()'s
-- precedent from ticket #34's own migration.
create or replace function ensure_integration_sync_job_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_tenant_id uuid;
begin
  select tenant_id into v_expected_tenant_id
    from public.integration_accounts
   where id = new.integration_account_id;

  if v_expected_tenant_id is null or v_expected_tenant_id <> new.tenant_id then
    raise exception 'integration_sync_jobs.tenant_id must match its integration_accounts row' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger integration_sync_jobs_ensure_tenant_match
  before insert or update on integration_sync_jobs
  for each row
  execute function ensure_integration_sync_job_tenant_match();

-- ----------------------------------------------------------------------------
-- integration_errors -- one row per failed sync job, a dedicated error queue
-- for a future reconciliation ticket (#39, out of scope here) to work from.
-- ----------------------------------------------------------------------------
create table integration_errors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  integration_sync_job_id uuid not null references integration_sync_jobs (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

comment on table integration_errors is
  'Ticket #38: one row per failed integration_sync_jobs row, written by record_integration_sync_job() in the same call. Retry/reconciliation over this table is ticket #39''s explicitly out-of-scope future work.';

create index integration_errors_tenant_id_idx on integration_errors (tenant_id);
create index integration_errors_sync_job_id_idx on integration_errors (integration_sync_job_id);

create or replace function ensure_integration_error_tenant_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_tenant_id uuid;
begin
  select tenant_id into v_expected_tenant_id
    from public.integration_sync_jobs
   where id = new.integration_sync_job_id;

  if v_expected_tenant_id is null or v_expected_tenant_id <> new.tenant_id then
    raise exception 'integration_errors.tenant_id must match its integration_sync_jobs row' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger integration_errors_ensure_tenant_match
  before insert or update on integration_errors
  for each row
  execute function ensure_integration_error_tenant_match();

-- ----------------------------------------------------------------------------
-- RLS -- all three tables. No INSERT/UPDATE/DELETE grant to `authenticated`
-- at all: every write goes exclusively through the SECURITY DEFINER RPCs
-- below, which bypass RLS as the function owner (same precedent as
-- moderate_rating()).
-- ----------------------------------------------------------------------------
alter table integration_accounts enable row level security;
alter table integration_sync_jobs enable row level security;
alter table integration_errors enable row level security;

grant select on integration_accounts to authenticated;
grant select, insert, update on integration_accounts to service_role;
grant select on integration_sync_jobs to authenticated;
grant select, insert on integration_sync_jobs to service_role;
grant select on integration_errors to authenticated;
grant select, insert on integration_errors to service_role;

revoke truncate on integration_accounts from anon, authenticated, service_role;
revoke truncate on integration_sync_jobs from anon, authenticated, service_role;
revoke truncate on integration_errors from anon, authenticated, service_role;

create policy integration_accounts_select_integrations_manage
  on integration_accounts
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'integrations.manage'));

create policy integration_sync_jobs_select_integrations_manage
  on integration_sync_jobs
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'integrations.manage'));

create policy integration_errors_select_integrations_manage
  on integration_errors
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'integrations.manage'));

-- ----------------------------------------------------------------------------
-- create_integration_account -- upserts the tenant's mock integration
-- account (idempotent: re-running it just refreshes the label).
-- ----------------------------------------------------------------------------
create or replace function create_integration_account(p_tenant_id uuid, p_provider_key text, p_label text)
returns integration_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.integration_accounts;
begin
  perform public.require_tenant_permission(p_tenant_id, 'integrations.manage');

  if p_provider_key not in ('mock') then
    raise exception 'Unsupported integration provider: %', p_provider_key using errcode = 'invalid_parameter_value';
  end if;

  insert into public.integration_accounts (tenant_id, provider_key, label, status)
  values (p_tenant_id, p_provider_key, p_label, 'mock')
  on conflict (tenant_id, provider_key) do update
     set label = excluded.label,
         updated_at = now()
  returning * into v_account;

  return v_account;
end;
$$;

comment on function create_integration_account(uuid, text, text) is
  'Ticket #38: creates (or refreshes the label of) the tenant''s integration account for the given provider. Gated on integrations.manage.';

revoke all on function create_integration_account(uuid, text, text) from public;
grant execute on function create_integration_account(uuid, text, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- list_integration_accounts -- admin overview read (ticket's "Integrations-
-- Übersicht im Admin" UI note).
-- ----------------------------------------------------------------------------
create or replace function list_integration_accounts(p_tenant_id uuid)
returns setof integration_accounts
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform public.require_tenant_permission(p_tenant_id, 'integrations.manage');

  return query
    select * from public.integration_accounts
     where tenant_id = p_tenant_id
     order by created_at;
end;
$$;

comment on function list_integration_accounts(uuid) is
  'Ticket #38: integrations.manage-gated list of a tenant''s integration accounts, for the admin integrations overview.';

revoke all on function list_integration_accounts(uuid) from public;
grant execute on function list_integration_accounts(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- list_integration_sync_jobs -- recent sync job history for the admin
-- overview (most recent 50, optionally scoped to one account).
-- ----------------------------------------------------------------------------
create or replace function list_integration_sync_jobs(p_tenant_id uuid, p_integration_account_id uuid default null)
returns setof integration_sync_jobs
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform public.require_tenant_permission(p_tenant_id, 'integrations.manage');

  return query
    select * from public.integration_sync_jobs
     where tenant_id = p_tenant_id
       and (p_integration_account_id is null or integration_account_id = p_integration_account_id)
     order by created_at desc
     limit 50;
end;
$$;

comment on function list_integration_sync_jobs(uuid, uuid) is
  'Ticket #38: integrations.manage-gated list of a tenant''s most recent 50 integration sync jobs, optionally filtered to one integration account.';

revoke all on function list_integration_sync_jobs(uuid, uuid) from public;
grant execute on function list_integration_sync_jobs(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- record_integration_sync_job -- the sole write path into
-- integration_sync_jobs/integration_errors, and the sole place
-- integration_accounts.status transitions between 'mock' and 'error'.
-- Called by application code (apps/web/src/lib/integrations/service.ts)
-- after the mock provider (packages/domain/src/integrations) has produced
-- its (always synchronous) result.
-- ----------------------------------------------------------------------------
create or replace function record_integration_sync_job(
  p_tenant_id uuid,
  p_integration_account_id uuid,
  p_job_type text,
  p_status text,
  p_payload jsonb,
  p_error_message text default null
)
returns integration_sync_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.integration_sync_jobs;
  v_account_tenant_id uuid;
begin
  perform public.require_tenant_permission(p_tenant_id, 'integrations.manage');

  if p_job_type not in ('menu_export', 'availability_sync', 'order_import', 'order_confirmation') then
    raise exception 'Invalid integration job type: %', p_job_type using errcode = 'invalid_parameter_value';
  end if;

  if p_status not in ('succeeded', 'failed') then
    raise exception 'Invalid integration job status: %', p_status using errcode = 'invalid_parameter_value';
  end if;

  select tenant_id into v_account_tenant_id
    from public.integration_accounts
   where id = p_integration_account_id;

  if v_account_tenant_id is null or v_account_tenant_id <> p_tenant_id then
    raise exception 'Integration account not found' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.integration_sync_jobs
    (tenant_id, integration_account_id, job_type, status, payload, error_message, completed_at)
  values
    (p_tenant_id, p_integration_account_id, p_job_type, p_status, coalesce(p_payload, '{}'::jsonb), p_error_message, now())
  returning * into v_job;

  if p_status = 'failed' then
    insert into public.integration_errors (tenant_id, integration_sync_job_id, message)
    values (p_tenant_id, v_job.id, coalesce(p_error_message, 'Unknown integration error'));

    update public.integration_accounts
       set status = 'error',
           updated_at = now()
     where id = p_integration_account_id
       and tenant_id = p_tenant_id;
  else
    -- A subsequent success clears a prior error state -- never overwrites a
    -- real (future, non-mock) 'connected' status, only 'error' or 'mock'.
    update public.integration_accounts
       set status = 'mock',
           updated_at = now()
     where id = p_integration_account_id
       and tenant_id = p_tenant_id
       and status = 'error';
  end if;

  insert into public.audit_logs (tenant_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id,
    auth.uid(),
    'integrations.sync_job_recorded',
    'integration_sync_job',
    v_job.id::text,
    jsonb_build_object(
      'jobType', p_job_type,
      'status', p_status,
      'integrationAccountId', p_integration_account_id
    )
  );

  return v_job;
end;
$$;

comment on function record_integration_sync_job(uuid, uuid, text, text, jsonb, text) is
  'Ticket #38: records the outcome of one integration sync attempt (menu_export/availability_sync/order_import/order_confirmation), gated on integrations.manage. Failed jobs also insert an integration_errors row and flip the account to status=error; a subsequent succeeded job clears status=error back to mock. Every call appends an audit_logs row (observability requirement).';

revoke all on function record_integration_sync_job(uuid, uuid, text, text, jsonb, text) from public;
grant execute on function record_integration_sync_job(uuid, uuid, text, text, jsonb, text) to authenticated, service_role;
