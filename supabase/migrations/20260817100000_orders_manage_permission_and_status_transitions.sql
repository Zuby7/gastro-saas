-- ============================================================================
-- Kitchen workflow status transitions (Epic 8, ticket #28)
-- ============================================================================
-- Adds the `orders.manage` permission (identified as missing by this
-- ticket's own prepare-ticket review comment) plus the sole write path that
-- lets staff drive an order through the preparation lifecycle (received ->
-- accepted -> preparing -> ready -> completed, or -> cancelled) from the
-- staff order dashboard board built in ticket #27.
--
-- Permission scoping (per the prepare-ticket review, same set as
-- `orders.read` before it): Owner/Manager/Service/Kitchen get `orders.manage`
-- by default -- all four roles are operationally involved in order
-- fulfillment. Marketing does NOT get it, for the same reason it doesn't
-- get `orders.read` (see 20260817090000's header): that role is deliberately
-- scoped to menu/revenue concerns, not individual order handling.
--
-- Core requirement (this ticket's user story): "Als Küchenpersonal möchte
-- ich den Zubereitungsstatus einer Bestellung ändern können, ohne Zugriff
-- auf Umsatzdaten zu haben." -- `orders.manage` is completely independent of
-- `payments.read`/`payments.refund`: a Kitchen member holding only
-- `orders.manage` (plus `orders.read`/`orders.cancel` from before) can call
-- `transition_order_status()` below successfully, while the existing
-- `payments.read`-gated policies from ticket #26
-- (20260809090000_refunds.sql) continue to deny that same member any
-- revenue/refund data -- this migration does not touch those policies at
-- all, it only adds a new, narrowly-scoped write path for order status.
--
-- Two enforcement layers, per this repo's standard: the caller
-- (`apps/web/src/app/account/orders/actions.ts`) must already have called
-- `requireTenantPermission(..., 'orders.manage')` before invoking the RPC,
-- AND `transition_order_status()` independently re-checks the same
-- permission itself (mirrors `publish_menu_version()`'s
-- `require_tenant_permission()` call in
-- 20260801110000_restaurant_profile_and_menu_management.sql). `orders`/
-- `order_status_events` deliberately carry NO RLS policies at all (see
-- 20260804090000_orders_state_machine_and_checkout.sql's header) -- every
-- write goes exclusively through a SECURITY DEFINER RPC, so a
-- SECURITY DEFINER function with its own independent permission re-check
-- (rather than an additional RLS policy) is the established mechanism for a
-- new authenticated-facing write path on these tables, matching
-- `create_order_from_cart()`'s precedent for the guest-facing write path.
--
-- Status transitions never write `orders.status` directly: they append to
-- the immutable `order_status_events` audit trail, and
-- `sync_order_status_from_event()` (already in place since ticket #21)
-- keeps the denormalized `orders.status` column in sync. Invalid
-- transitions are rejected by `validate_order_status_event()`'s existing
-- trigger -- the actual, authoritative enforcement point -- this migration
-- additionally pre-checks `is_valid_order_status_transition()` itself purely
-- to surface a clear, translated-friendly error before ever hitting the
-- trigger (same "clear error before the DB-level guard" precedent as
-- `create_order_from_cart()`'s unique-violation handling).
--
-- Rollback for local/throwaway DBs:
--   revoke all on function transition_order_status(uuid, uuid, text) from authenticated, service_role;
--   drop function if exists transition_order_status(uuid, uuid, text);
--   delete from role_permissions where permission_key = 'orders.manage';
--   delete from permissions where key = 'orders.manage';
-- ============================================================================

insert into permissions (key, description)
values ('orders.manage', 'Change an order''s preparation status (kitchen/service workflow)')
on conflict (key) do update set description = excluded.description;

-- Owner already receives every catalog permission automatically for *new*
-- tenants (seed_standard_roles_for_tenant() cross-joins the full
-- `permissions` table). Existing tenants need an explicit backfill, same
-- pattern as `orders.read` before it.
insert into role_permissions (role_id, permission_key)
select r.id, p.key
  from roles r
 cross join permissions p
 where r.key = 'owner'
   and p.key = 'orders.manage'
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, grants.permission_key
  from roles r
  join (
    values
      ('manager', 'orders.manage'),
      ('service', 'orders.manage'),
      ('kitchen', 'orders.manage')
  ) as grants(role_key, permission_key) on grants.role_key = r.key
on conflict do nothing;

-- Same "existing tenants backfilled above, new tenants via this function
-- going forward" pattern as `orders.read` before it. Function body is
-- otherwise byte-for-byte identical to the previous version
-- (20260817090000_orders_read_permission_and_staff_dashboard.sql's replace).
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
-- transition_order_status -- the sole staff-facing write path for the kitchen
-- workflow. Appends a validated order_status_events row (never writes
-- orders.status directly) and lets sync_order_status_from_event() (ticket
-- #21) keep the denormalized column in sync.
-- ----------------------------------------------------------------------------
create or replace function transition_order_status(p_tenant_id uuid, p_order_id uuid, p_to_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_status text;
  v_actor_user_id uuid := auth.uid();
begin
  perform public.require_tenant_permission(p_tenant_id, 'orders.manage');

  -- `for update`: locks the order row for the remainder of this transaction,
  -- serializing concurrent transition attempts for the same order (mirrors
  -- create_order_from_cart()'s row-lock precedent) -- without it, two
  -- concurrent staff taps on the same order could both read the same
  -- "current" status and race to append two events, one of which
  -- validate_order_status_event() would then reject with a confusing
  -- "from_status does not match" error instead of this function's clearer
  -- "invalid transition" message.
  select status into v_current_status
    from public.orders
   where id = p_order_id
     and tenant_id = p_tenant_id
     for update;

  if v_current_status is null then
    raise exception 'Order not found' using errcode = 'invalid_parameter_value';
  end if;

  if not public.is_valid_order_status_transition(v_current_status, p_to_status) then
    raise exception 'Invalid order status transition: % -> %', v_current_status, p_to_status
      using errcode = 'check_violation';
  end if;

  insert into public.order_status_events (tenant_id, order_id, from_status, to_status, actor_user_id)
  values (p_tenant_id, p_order_id, v_current_status, p_to_status, v_actor_user_id);

  return jsonb_build_object('orderId', p_order_id, 'status', p_to_status);
end;
$$;

comment on function transition_order_status(uuid, uuid, text) is
  'Ticket #28: staff-facing order status transition (received -> accepted -> preparing -> ready -> completed, or -> cancelled), gated on orders.manage (independently re-checked here on top of the caller''s own requireTenantPermission call). Never writes orders.status directly -- appends to order_status_events, validated by validate_order_status_event()''s existing trigger, which is the actual source-of-truth enforcement for the transition table.';

revoke all on function transition_order_status(uuid, uuid, text) from public;
grant execute on function transition_order_status(uuid, uuid, text) to authenticated, service_role;
