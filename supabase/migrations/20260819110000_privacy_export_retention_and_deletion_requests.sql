-- ============================================================================
-- Privacy: retention config, tenant data export, deletion-request workflow
-- (Epic 11, ticket #36, risk:privacy)
-- ============================================================================
-- Three pieces, all tenant-scoped:
--
-- 1. `privacy_retention_settings` -- one configurable retention period per
--    tenant, for `analytics_events` only (ticket's own scope: "konfigurierbare
--    Aufbewahrungsfristen fuer Logs/Analytics-Events"). `audit_logs` is
--    deliberately NOT configurable here and is never purged by app code --
--    ticket #6 made it append-only/immutable for every app-facing role
--    (`reject_audit_log_mutation()`,
--    20260801050000_audit_log_and_analytics_events_skeleton.sql) as a
--    security/compliance invariant; this ticket does not reopen that. A
--    tenant's audit trail can only ever be removed via the same privileged,
--    non-app-facing purge path ticket #6 already documented.
--
-- 2. `export_tenant_data(p_tenant_id)` -- a single SECURITY DEFINER RPC that
--    assembles the tenant's own operational data (profile, opening hours,
--    team, menu, orders/payments, retention settings, deletion history) as
--    one jsonb document, gated on `tenant.settings.write` (matches the
--    ticket's own "Berechtigungen" note: export uses the same permission as
--    other tenant-settings reads/writes). A single narrow function, rather
--    than new blanket SELECT policies on `order_items`/`order_item_selections`
--    (which today carry NO policies at all -- see
--    20260804090000_orders_state_machine_and_checkout.sql's "Layer 0" note --
--    every read of those tables is deliberately funneled through a narrow,
--    already-tenant-scoped function, mirroring
--    `get_tenant_order_payment_statuses()`'s precedent rather than widening
--    RLS for every future caller).
--
-- 3. `data_deletion_requests` + `process_tenant_data_deletion_request(...)` --
--    the Owner-only (`tenant.data.delete`, new permission, mirrors
--    `payments.connect`'s Owner-only precedent) deletion-request workflow.
--    Acceptance criterion 2 ("Loeschantrag respektiert dokumentierte
--    gesetzliche Aufbewahrungspflichten... statt sie zu ignorieren"):
--      - `orders`/`order_items`/`order_item_selections`/`payments` rows are
--        NEVER hard-deleted (matches `.claude/rules/database-migrations.md`'s
--        "prefer archive/soft-delete over hard delete for anything that
--        participates in historical orders", and `orders.tenant_id`/
--        `payments.tenant_id` are already `on delete restrict`).
--      - Orders strictly younger than `v_legal_retention_days` (3650 days /
--        10 years, documented default modelled on the German commercial/tax
--        retention duty for business records -- HGB Sec. 257 / AO Sec. 147;
--        NOT legal advice, see the ticket's own explicit non-goal "Keine
--        automatische Rechtsberatung/Compliance-Zertifizierung" and
--        docs/security/threat-model.md's residual-responsibility split) are
--        left completely untouched -- this is the behaviour the required
--        integration test proves.
--      - Orders at/past that age have their customer-identifying columns
--        (`customer_name`/`customer_phone`/`table_identifier`/
--        `customer_note` -- the only orders columns
--        `guard_orders_payment_fields_change()` leaves mutable, see
--        20260804090000's guard) anonymized in place. `total_cents`/
--        `currency`/line items/payments -- the actual financial/accounting
--        record the retention duty protects -- are never touched.
--      - `analytics_events` (no legal retention duty) are purged in full for
--        the tenant, regardless of the configurable retention setting --
--        a deletion request is a stronger, immediate-erasure signal than the
--        ordinary scheduled retention window.
--      - Explicit non-goals, called out here rather than silently narrowed:
--        this workflow does NOT delete the tenant record itself, staff
--        accounts/memberships, menu data, or the audit trail -- full
--        tenant/account deletion is a materially larger effort (Stripe
--        Connect disconnection, membership/ownership reassignment, storage
--        object cleanup) outside this ticket's stated scope
--        (orders/payments retention + logs/analytics retention), and is
--        tracked as a residual follow-up, not silently done or silently
--        skipped.
--
-- Rollback for local/throwaway DBs:
--   revoke all on function process_tenant_data_deletion_request(uuid, text) from authenticated, service_role;
--   drop function if exists process_tenant_data_deletion_request(uuid, text);
--   drop table if exists data_deletion_requests;
--   revoke all on function export_tenant_data(uuid) from authenticated, service_role;
--   drop function if exists export_tenant_data(uuid);
--   revoke all on function purge_expired_analytics_events(uuid) from authenticated, service_role;
--   drop function if exists purge_expired_analytics_events(uuid);
--   drop trigger if exists privacy_retention_settings_set_updated_at on privacy_retention_settings;
--   drop table if exists privacy_retention_settings;
--   delete from role_permissions where permission_key = 'tenant.data.delete';
--   delete from permissions where key = 'tenant.data.delete';
-- ============================================================================

-- ----------------------------------------------------------------------------
-- New Owner-only permission for the deletion-request workflow
-- ----------------------------------------------------------------------------
insert into permissions (key, description)
values ('tenant.data.delete', 'Request tenant data deletion (anonymizes order PII past the legal retention period, purges analytics events)')
on conflict (key) do update set description = excluded.description;

-- Owner already receives every catalog permission automatically for *new*
-- tenants (seed_standard_roles_for_tenant() cross-joins the full
-- `permissions` table). Existing tenants need an explicit backfill, same
-- pattern as `payments.connect` before it. Deliberately Owner-only, not
-- Manager -- mirrors payments.connect's rationale (this is a
-- data-protection-consequential action, not routine operations).
insert into role_permissions (role_id, permission_key)
select r.id, p.key
  from roles r
 cross join permissions p
 where r.key = 'owner'
   and p.key = 'tenant.data.delete'
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
    (v_manager_role_id, 'orders.cancel'),
    (v_manager_role_id, 'orders.read'),
    (v_manager_role_id, 'orders.manage'),
    (v_manager_role_id, 'payments.refund'),
    (v_manager_role_id, 'payments.read'),
    (v_manager_role_id, 'analytics.read'),
    (v_manager_role_id, 'audit.read'),
    (v_kitchen_role_id, 'orders.cancel'),
    (v_kitchen_role_id, 'orders.read'),
    (v_kitchen_role_id, 'orders.manage'),
    (v_service_role_id, 'orders.cancel'),
    (v_service_role_id, 'orders.read'),
    (v_service_role_id, 'orders.manage'),
    (v_marketing_role_id, 'menu.publish'),
    (v_marketing_role_id, 'analytics.read')
  on conflict do nothing;

  return new;
end;
$$;

comment on function seed_standard_roles_for_tenant() is
  'Creates the Owner/Manager/Kitchen/Service/Marketing system roles for a tenant and attaches their default permissions.';

-- ----------------------------------------------------------------------------
-- 1. privacy_retention_settings
-- ----------------------------------------------------------------------------
create table privacy_retention_settings (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  analytics_events_retention_days integer not null default 365
    check (analytics_events_retention_days between 30 and 3650),
  updated_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table privacy_retention_settings is
  'Ticket #36: tenant-configurable retention period for analytics_events only. audit_logs is deliberately excluded -- it is append-only/immutable for every app-facing role by design (ticket #6) and is never purged by application code. A tenant without a row here uses purge_expired_analytics_events()''s hardcoded default (365 days).';

create trigger privacy_retention_settings_set_updated_at
  before update on privacy_retention_settings
  for each row
  execute function set_updated_at();

alter table privacy_retention_settings enable row level security;

grant select, insert, update, delete on privacy_retention_settings to authenticated, service_role;
revoke truncate on privacy_retention_settings from anon, authenticated, service_role;

select apply_basic_tenant_policies('privacy_retention_settings', 'tenant.settings.write');

-- ----------------------------------------------------------------------------
-- purge_expired_analytics_events -- manual/on-demand purge, callable by any
-- tenant.settings.write holder (the same permission that can configure the
-- retention period in the first place).
-- ----------------------------------------------------------------------------
create or replace function purge_expired_analytics_events(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retention_days integer;
  v_deleted_count integer;
begin
  perform public.require_tenant_permission(p_tenant_id, 'tenant.settings.write');

  select analytics_events_retention_days into v_retention_days
    from public.privacy_retention_settings
   where tenant_id = p_tenant_id;

  v_retention_days := coalesce(v_retention_days, 365);

  with purged as (
    delete from public.analytics_events
     where tenant_id = p_tenant_id
       and created_at < now() - make_interval(days => v_retention_days)
    returning id
  )
  select count(*) into v_deleted_count from purged;

  return v_deleted_count;
end;
$$;

comment on function purge_expired_analytics_events(uuid) is
  'Ticket #36: deletes analytics_events rows older than the tenant''s configured (or default 365-day) retention period. Gated on tenant.settings.write, independently re-checked here on top of the caller''s own requireTenantPermission call.';

revoke all on function purge_expired_analytics_events(uuid) from public;
grant execute on function purge_expired_analytics_events(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. export_tenant_data
-- ----------------------------------------------------------------------------
create or replace function export_tenant_data(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_result jsonb;
begin
  perform public.require_tenant_permission(p_tenant_id, 'tenant.settings.write');

  select jsonb_build_object(
    'exportedAt', now(),
    'tenantId', p_tenant_id,
    'tenant', (
      select jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'createdAt', t.created_at)
        from public.tenants t
       where t.id = p_tenant_id
    ),
    'restaurantProfile', (
      select to_jsonb(rp) - 'tenant_id'
        from public.restaurant_profiles rp
       where rp.tenant_id = p_tenant_id
    ),
    'openingHours', (
      select coalesce(jsonb_agg(to_jsonb(oh) - 'tenant_id' order by oh.weekday), '[]'::jsonb)
        from public.opening_hours oh
       where oh.tenant_id = p_tenant_id
    ),
    'team', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'userId', tm.user_id,
            'email', u.email,
            'role', tm.role,
            'memberSince', tm.created_at
          )
        ),
        '[]'::jsonb
      )
        from public.tenant_memberships tm
        join auth.users u on u.id = tm.user_id
       where tm.tenant_id = p_tenant_id
    ),
    'menu', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', d.id,
            'name', d.name,
            'description', d.description,
            'priceCents', d.price_cents,
            'currency', d.currency,
            'archivedAt', d.archived_at
          )
        ),
        '[]'::jsonb
      )
        from public.dishes d
       where d.tenant_id = p_tenant_id
    ),
    'orders', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'status', o.status,
            'fulfillmentType', o.fulfillment_type,
            'customerName', o.customer_name,
            'customerPhone', o.customer_phone,
            'tableIdentifier', o.table_identifier,
            'customerNote', o.customer_note,
            'totalCents', o.total_cents,
            'currency', o.currency,
            'createdAt', o.created_at,
            'items', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'dishName', oi.dish_name_snapshot,
                    'variantName', oi.variant_name_snapshot,
                    'quantity', oi.quantity,
                    'unitPriceCents', oi.unit_price_cents_snapshot,
                    'currency', oi.currency
                  )
                ),
                '[]'::jsonb
              )
                from public.order_items oi
               where oi.order_id = o.id
            )
          )
          order by o.created_at desc
        ),
        '[]'::jsonb
      )
        from public.orders o
       where o.tenant_id = p_tenant_id
    ),
    'payments', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'orderId', p.order_id,
            'status', p.status,
            'amountCents', p.amount_cents,
            'currency', p.currency,
            'createdAt', p.created_at
          )
          order by p.created_at desc
        ),
        '[]'::jsonb
      )
        from public.payments p
       where p.tenant_id = p_tenant_id
    ),
    'retentionSettings', (
      select jsonb_build_object('analyticsEventsRetentionDays', prs.analytics_events_retention_days)
        from public.privacy_retention_settings prs
       where prs.tenant_id = p_tenant_id
    ),
    'deletionRequests', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', ddr.id,
            'status', ddr.status,
            'requestedAt', ddr.requested_at,
            'processedAt', ddr.processed_at,
            'retainedOrdersCount', ddr.retained_orders_count,
            'anonymizedOrdersCount', ddr.anonymized_orders_count,
            'analyticsEventsPurgedCount', ddr.analytics_events_purged_count
          )
          order by ddr.requested_at desc
        ),
        '[]'::jsonb
      )
        from public.data_deletion_requests ddr
       where ddr.tenant_id = p_tenant_id
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function export_tenant_data(uuid) is
  'Ticket #36: assembles the tenant''s own operational data (profile, opening hours, team, basic menu, orders/items, payments, retention settings, deletion-request history) as one jsonb document. Gated on tenant.settings.write. Deliberately a single narrow function rather than new blanket SELECT policies on order_items/order_item_selections (which carry no policies at all today, see 20260804090000''s Layer 0 note) -- every referenced table is explicitly filtered by p_tenant_id in this function body.';

revoke all on function export_tenant_data(uuid) from public;
grant execute on function export_tenant_data(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. data_deletion_requests + process_tenant_data_deletion_request
-- ----------------------------------------------------------------------------
create table data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  requested_by_user_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  reason text check (reason is null or char_length(reason) <= 500),
  retained_orders_count integer,
  anonymized_orders_count integer,
  analytics_events_purged_count integer,
  requested_at timestamptz not null default now(),
  processed_at timestamptz
);

comment on table data_deletion_requests is
  'Ticket #36 (risk:privacy): one row per tenant deletion request, written exclusively by process_tenant_data_deletion_request() (SECURITY DEFINER, Owner-only via tenant.data.delete). Records how many orders were retained (still inside the documented legal retention period) vs. anonymized (past it) and how many analytics_events rows were purged -- never a record of a full tenant/account deletion, which this ticket does not implement (see migration header).';

create index data_deletion_requests_tenant_id_idx on data_deletion_requests (tenant_id, requested_at desc);

alter table data_deletion_requests enable row level security;

-- No insert/update/delete grant to `authenticated` at all: the only writer is
-- process_tenant_data_deletion_request() below, a SECURITY DEFINER function
-- owned by the migration-applying role, which does not need a GRANT to
-- `authenticated` to write (mirrors payment_accounts' service-role-only write
-- precedent, and finalize_refund()'s "the RPC is the only writer" pattern).
grant select on data_deletion_requests to authenticated;
grant select, insert, update on data_deletion_requests to service_role;
revoke truncate on data_deletion_requests from anon, authenticated, service_role;

-- Visibility restricted to tenant.data.delete holders (Owner), not every
-- tenant member -- a deletion request's existence/history is itself
-- sensitive, data-protection-relevant information.
create policy data_deletion_requests_select_owner
  on data_deletion_requests
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'tenant.data.delete'));

-- ----------------------------------------------------------------------------
-- process_tenant_data_deletion_request -- see migration header for the full
-- retention rationale.
-- ----------------------------------------------------------------------------
create or replace function process_tenant_data_deletion_request(p_tenant_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_request_id uuid;
  -- Documented default, not legal advice (ticket #36's explicit non-goal):
  -- modelled on the German commercial/tax retention duty for business
  -- records (HGB Sec. 257 / AO Sec. 147, 10 years). Hardcoded rather than
  -- tenant-configurable -- unlike analytics_events' retention period, this is
  -- a legal-minimum floor, not an operational preference.
  v_legal_retention_days constant integer := 3650;
  v_cutoff timestamptz;
  v_retained_count integer;
  v_anonymized_count integer;
  v_analytics_purged_count integer;
  v_anonymized_name constant text := '[Geloescht - Aufbewahrungsfrist gemaess Dokumentation abgelaufen]';
  v_anonymized_table_identifier constant text := '[geloescht]';
begin
  perform public.require_tenant_permission(p_tenant_id, 'tenant.data.delete');

  v_cutoff := now() - make_interval(days => v_legal_retention_days);

  insert into public.data_deletion_requests (tenant_id, requested_by_user_id, status, reason)
  values (p_tenant_id, v_actor_user_id, 'processing', nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_request_id;

  -- Orders still inside the legal retention window: counted, but left
  -- completely untouched -- this is what the required integration test
  -- proves.
  select count(*) into v_retained_count
    from public.orders
   where tenant_id = p_tenant_id
     and created_at >= v_cutoff;

  -- Orders past the retention window: anonymize customer-identifying columns
  -- only. total_cents/currency/order_items/order_item_selections/payments
  -- (the actual accounting record) are never touched, and no row is ever
  -- deleted (orders.tenant_id/payments.tenant_id are `on delete restrict`,
  -- and order_items/order_item_selections/order_status_events are immutable
  -- once written -- see 20260804090000's guards).
  with anonymized as (
    update public.orders
       set customer_name = v_anonymized_name,
           customer_phone = null,
           table_identifier = case when table_identifier is not null then v_anonymized_table_identifier else null end,
           customer_note = ''
     where tenant_id = p_tenant_id
       and created_at < v_cutoff
       and customer_name is distinct from v_anonymized_name
    returning id
  )
  select count(*) into v_anonymized_count from anonymized;

  -- analytics_events carries no legal retention duty -- a deletion request is
  -- a stronger, immediate-erasure signal than the ordinary configurable
  -- retention window, so every row for this tenant is purged now regardless
  -- of privacy_retention_settings.
  with purged as (
    delete from public.analytics_events
     where tenant_id = p_tenant_id
    returning id
  )
  select count(*) into v_analytics_purged_count from purged;

  update public.data_deletion_requests
     set status = 'completed',
         processed_at = now(),
         retained_orders_count = v_retained_count,
         anonymized_orders_count = v_anonymized_count,
         analytics_events_purged_count = v_analytics_purged_count
   where id = v_request_id;

  insert into public.audit_logs (tenant_id, actor_user_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id,
    v_actor_user_id,
    'privacy.deletion_request.completed',
    'tenant',
    p_tenant_id::text,
    jsonb_build_object(
      'requestId', v_request_id,
      'retainedOrdersCount', v_retained_count,
      'anonymizedOrdersCount', v_anonymized_count,
      'analyticsEventsPurgedCount', v_analytics_purged_count,
      'legalRetentionDays', v_legal_retention_days
    )
  );

  return v_request_id;
end;
$$;

comment on function process_tenant_data_deletion_request(uuid, text) is
  'Ticket #36 (risk:privacy): Owner-only (tenant.data.delete) deletion-request workflow. Never hard-deletes orders/order_items/order_item_selections/payments. Orders still inside the documented 3650-day legal retention window are left untouched (counted in retained_orders_count); orders past it have only their customer-identifying columns anonymized (anonymized_orders_count). analytics_events (no legal retention duty) are purged in full. audit_logs is never touched -- see migration header.';

revoke all on function process_tenant_data_deletion_request(uuid, text) from public;
grant execute on function process_tenant_data_deletion_request(uuid, text) to authenticated, service_role;
