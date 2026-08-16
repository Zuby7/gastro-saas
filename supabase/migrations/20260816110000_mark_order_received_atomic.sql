-- ============================================================================
-- Atomic order-received + payment-paid transition (issue #90)
-- ============================================================================
-- `markOrderReceived()` in apps/web/src/lib/payments/webhook-service.ts
-- previously performed the order_status_events insert (which triggers
-- orders.status -> 'received' via sync_order_status_from_event()) and the
-- payments.status -> 'paid' update as two separate round trips from the
-- Node process. A crash (process restart, connection drop) between the two
-- left an order "received" with its payment still "pending" -- permanently
-- non-refundable through the normal UI (issueRefundForOrder() only reads
-- payments with status='paid'), with no automatic recovery path.
--
-- Fix: a single service_role SECURITY DEFINER RPC that performs both writes
-- in one statement-level transaction -- a single RPC call is one round trip
-- from the Node process, and if either write fails, the whole call rolls
-- back atomically (Postgres function bodies execute inside the calling
-- transaction; an uncaught exception rolls back everything the function did).
--
-- The existing behavior of "gracefully decline without erroring when the
-- order's status already moved on (race/out-of-order webhook)" is preserved:
-- validate_order_status_event() raises with errcode = 'check_violation' for
-- an invalid transition or a from_status mismatch (see that trigger), which
-- this function catches (in a nested block scoped to that one statement, not
-- the whole function body) and turns into `returns false` instead of an
-- unhandled exception -- any OTHER error, including a check_violation raised
-- by the payments UPDATE itself, still propagates so the caller (and
-- Stripe, via the webhook route's response code) can tell the difference
-- and retry, rather than being misreported as the benign race case.
--
-- Rollback for local/throwaway DBs:
--   drop function if exists mark_order_received_and_paid(uuid, uuid, uuid, text);
-- ============================================================================

create or replace function mark_order_received_and_paid(
  p_tenant_id uuid,
  p_order_id uuid,
  p_payment_id uuid,
  p_stripe_payment_intent_id text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Nested block: its own exception scope, so ONLY a check_violation raised
  -- by THIS insert (i.e. validate_order_status_event() rejecting the
  -- transition) is treated as the graceful "order status already moved on"
  -- case. A check_violation from the payments UPDATE below (e.g. a
  -- malformed p_stripe_payment_intent_id tripping its ~ '^pi_' constraint)
  -- must NOT be swallowed the same way -- that would silently report a real
  -- failure to the caller as a benign race, acknowledge the webhook, and
  -- lose the payment transition with no retry (cycle-3 review finding).
  begin
    insert into public.order_status_events (tenant_id, order_id, from_status, to_status)
    values (p_tenant_id, p_order_id, 'awaiting_payment', 'received');
  exception
    when check_violation then
      -- The order's status already moved on (a race, or a delayed/out-of-order
      -- webhook retry) -- validate_order_status_event() rejected the
      -- from_status='awaiting_payment' -> to_status='received' transition.
      -- Caller logs and acknowledges the webhook without marking the payment
      -- paid, exactly as the pre-existing (non-atomic) behavior did.
      return false;
  end;

  -- Defense in depth beyond the id match: also require the row to still
  -- belong to this tenant/order and still be 'pending' -- a no-op update
  -- (0 rows affected) is not itself an error, but combined with the
  -- explicit id it means this call can never touch a payment row it wasn't
  -- meant to.
  update public.payments
     set status = 'paid',
         stripe_payment_intent_id = coalesce(p_stripe_payment_intent_id, stripe_payment_intent_id)
   where id = p_payment_id
     and tenant_id = p_tenant_id
     and order_id = p_order_id
     and status = 'pending';

  return true;
end;
$$;

comment on function mark_order_received_and_paid(uuid, uuid, uuid, text) is
  'Atomically transitions an order to received and its payment to paid in one call (issue #90) -- replaces two separate writes from webhook-service.ts that could leave an order received with its payment still pending if the process crashed between them. Returns false (not an exception) ONLY if the order_status_events insert itself was rejected (order status already moved on, race/out-of-order event); a failure in the payments UPDATE (e.g. a malformed stripe_payment_intent_id) is NOT swallowed the same way and propagates as a real error instead. The payments UPDATE additionally requires tenant_id/order_id/status=''pending'' to match, not just the id.';

revoke all on function mark_order_received_and_paid(uuid, uuid, uuid, text) from public;
grant execute on function mark_order_received_and_paid(uuid, uuid, uuid, text) to service_role;
