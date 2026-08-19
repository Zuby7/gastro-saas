-- ============================================================================
-- Epic 8 Opus batch review fix for ticket #28 (medium finding 4)
-- ============================================================================
-- transition_order_status() gated every transition -- including
-- '-> cancelled' -- on orders.manage alone, even though a separate
-- orders.cancel permission already exists and is granted independently
-- (Kitchen/Service/Manager all hold both today, but nothing stopped a future
-- role from holding orders.manage without orders.cancel, or vice versa, and
-- the RPC would still let an orders.manage-only holder cancel an order). The
-- board's own UI only ever offers cancellation-adjacent buttons behind
-- `orders.cancel` checks client-side (`nextForwardStatuses()` in
-- order-board.tsx deliberately excludes 'cancelled' from its forward-flow
-- buttons already) -- but UI hiding is never authorization, and
-- transitionOrderStatusAction()/transition_order_status() are both directly
-- callable with `toStatus = 'cancelled'` regardless of what buttons the
-- board renders.
--
-- Fix: cancellation now additionally requires orders.cancel, checked in both
-- transition_order_status() (the actual enforcement boundary) and
-- transitionOrderStatusAction() (the earlier, cheaper app-layer check that
-- matches this repo's "two enforcement layers" standard for gated actions).
-- Every other transition is unaffected -- still gated on orders.manage alone.
--
-- Rollback for local/throwaway DBs: re-apply the previous
-- transition_order_status() body from
-- 20260817100000_orders_manage_permission_and_status_transitions.sql.
-- ============================================================================

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

  -- Finding 4: cancellation is a distinct, separately-scoped action from the
  -- rest of the kitchen-workflow preparation lifecycle -- require
  -- orders.cancel in addition to orders.manage for this one target status.
  if p_to_status = 'cancelled' then
    perform public.require_tenant_permission(p_tenant_id, 'orders.cancel');
  end if;

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
  'Ticket #28: staff-facing order status transition (received -> accepted -> preparing -> ready -> completed, or -> cancelled), gated on orders.manage (independently re-checked here on top of the caller''s own requireTenantPermission call). Cancellation additionally requires orders.cancel (Epic 8 Opus batch review, finding 4). Never writes orders.status directly -- appends to order_status_events, validated by validate_order_status_event()''s existing trigger, which is the actual source-of-truth enforcement for the transition table.';

revoke all on function transition_order_status(uuid, uuid, text) from public;
grant execute on function transition_order_status(uuid, uuid, text) to authenticated, service_role;
