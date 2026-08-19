-- ============================================================================
-- Live order dashboard for staff (Epic 8, ticket #27, risk:tenant-isolation)
-- ============================================================================
-- Adds the `orders.read` permission (identified as missing by this ticket's
-- own prepare-ticket review comment -- the "Datenbank/Migration: Keine neue"
-- note in the ticket body was itself a mistake the reviewer caught) plus the
-- tenant-scoped, orders.read-gated SELECT policy the staff order dashboard's
-- list/board view reads through.
--
-- Permission scoping (per the prepare-ticket review): Owner/Manager/Service/
-- Kitchen get `orders.read` by default -- all four roles are operationally
-- involved in order fulfillment. Marketing does NOT get it -- that role is
-- deliberately scoped to menu/revenue concerns only
-- (seed_standard_roles_for_tenant()'s own comment: "Menu publishing and
-- analytics access without payment authority"), and has no reason to see
-- individual orders or customer names.
--
-- Two enforcement layers, per this repo's standard: `apps/web/src/app/account/
-- orders/page.tsx` calls `requireTenantPermission(..., 'orders.read')` before
-- ever querying, AND the `orders_select_orders_read` policy below
-- independently re-checks the same permission. This is ADDITIONAL to (not a
-- replacement for) the narrow `orders_select_payments_read` policy from
-- ticket #26 (20260809090000_refunds.sql) -- that policy's own comment
-- explicitly says Epic 8 would add "its own, differently-scoped orders
-- SELECT policy" rather than replace it, since a payments.read holder without
-- orders.read (if that combination is ever configured by a tenant's custom
-- roles.manage role) should still keep working for the refund admin page.
-- Postgres combines multiple permissive SELECT policies on the same table
-- with OR, so both stay independently effective.
--
-- Payment-status-per-order (ticket's own "Zahlungen: Zeigt Zahlungsstatus je
-- Bestellung" requirement): rather than requiring `payments.read` too (which
-- would exclude Service/Kitchen -- neither holds it, and per ticket #26's own
-- scoping decision, financial detail like amounts/Stripe ids should stay
-- behind `payments.read`), `get_tenant_order_payment_statuses()` below is a
-- narrow, `orders.read`-gated projection that returns only a coarse status
-- label per order (unpaid/processing/paid/partially_refunded/refunded/
-- failed) -- no amounts, no Stripe identifiers, no refund reasons. A viewer
-- who additionally holds `payments.read` can still open the existing order
-- detail page (ticket #26) for full financial detail.
--
-- Rollback for local/throwaway DBs:
--   drop function if exists get_tenant_order_payment_statuses(uuid, uuid[]);
--   drop policy if exists orders_select_orders_read on orders;
--   delete from role_permissions where permission_key = 'orders.read';
--   delete from permissions where key = 'orders.read';
-- ============================================================================

insert into permissions (key, description)
values ('orders.read', 'View the tenant''s orders (staff order dashboard/board)')
on conflict (key) do update set description = excluded.description;

-- Owner already receives every catalog permission automatically for *new*
-- tenants (seed_standard_roles_for_tenant() cross-joins the full
-- `permissions` table). Existing tenants need an explicit backfill, same
-- pattern as `payments.read`/`payments.connect` before it.
insert into role_permissions (role_id, permission_key)
select r.id, p.key
  from roles r
 cross join permissions p
 where r.key = 'owner'
   and p.key = 'orders.read'
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, grants.permission_key
  from roles r
  join (
    values
      ('manager', 'orders.read'),
      ('service', 'orders.read'),
      ('kitchen', 'orders.read')
  ) as grants(role_key, permission_key) on grants.role_key = r.key
on conflict do nothing;

-- Same "existing tenants backfilled above, new tenants via this function
-- going forward" pattern as `payments.read` in
-- 20260808130000_stripe_connect_payment_accounts.sql. Function body is
-- otherwise byte-for-byte identical to the previous version
-- (20260808130000_stripe_connect_payment_accounts.sql's replace).
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
    (v_manager_role_id, 'payments.refund'),
    (v_manager_role_id, 'payments.read'),
    (v_manager_role_id, 'analytics.read'),
    (v_manager_role_id, 'audit.read'),
    (v_kitchen_role_id, 'orders.cancel'),
    (v_kitchen_role_id, 'orders.read'),
    (v_service_role_id, 'orders.cancel'),
    (v_service_role_id, 'orders.read'),
    (v_marketing_role_id, 'menu.publish'),
    (v_marketing_role_id, 'analytics.read')
  on conflict do nothing;

  return new;
end;
$$;

comment on function seed_standard_roles_for_tenant() is
  'Creates the Owner/Manager/Kitchen/Service/Marketing system roles for a tenant and attaches their default permissions.';

-- ----------------------------------------------------------------------------
-- orders: staff order dashboard SELECT policy, gated on orders.read.
-- ----------------------------------------------------------------------------
create policy orders_select_orders_read
  on orders
  for select
  to authenticated
  using (has_tenant_permission(tenant_id, 'orders.read'));

-- ----------------------------------------------------------------------------
-- get_tenant_order_payment_statuses: narrow, orders.read-gated projection of
-- payment status per order -- see migration header for the rationale. Never
-- returns amounts, Stripe identifiers, or refund reasons/timestamps.
-- ----------------------------------------------------------------------------
create or replace function get_tenant_order_payment_statuses(p_tenant_id uuid, p_order_ids uuid[])
returns table (order_id uuid, payment_status text)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform public.require_tenant_permission(p_tenant_id, 'orders.read');

  return query
    select o.id as order_id,
      case
        when latest.status is null then 'unpaid'
        when latest.status = 'pending' then 'processing'
        when latest.status = 'failed' then 'failed'
        when latest.status = 'cancelled' then 'unpaid'
        when latest.status = 'paid' and coalesce(refunded.amount_cents, 0) >= latest.amount_cents then 'refunded'
        when latest.status = 'paid' and coalesce(refunded.amount_cents, 0) > 0 then 'partially_refunded'
        else 'paid'
      end as payment_status
      from public.orders o
      left join lateral (
        select p.status, p.amount_cents, p.id
          from public.payments p
         where p.order_id = o.id
           and p.tenant_id = p_tenant_id
         order by p.created_at desc
         limit 1
      ) latest on true
      left join lateral (
        select coalesce(sum(r.amount_cents), 0)::int as amount_cents
          from public.refunds r
         where r.payment_id = latest.id
           and r.status = 'succeeded'
      ) refunded on true
     where o.tenant_id = p_tenant_id
       and o.id = any (p_order_ids);
end;
$$;

comment on function get_tenant_order_payment_statuses(uuid, uuid[]) is
  'Ticket #27: narrow orders.read-gated payment-status label per order (unpaid/processing/paid/partially_refunded/refunded/failed) for the staff order dashboard -- deliberately returns no amounts/Stripe ids/refund reasons (those stay behind payments.read via the existing order detail page, ticket #26). p_order_ids must already be tenant-scoped by the caller; this function additionally filters on p_tenant_id itself as a second guard.';

revoke all on function get_tenant_order_payment_statuses(uuid, uuid[]) from public;
grant execute on function get_tenant_order_payment_statuses(uuid, uuid[]) to authenticated, service_role;
