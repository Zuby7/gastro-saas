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
-- this function catches and turns into `returns false` instead of an
-- unhandled exception -- any OTHER error (unexpected DB failure) still
-- propagates so the caller (and Stripe, via the webhook route's response
-- code) can tell the difference and retry.
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
  insert into public.order_status_events (tenant_id, order_id, from_status, to_status)
  values (p_tenant_id, p_order_id, 'awaiting_payment', 'received');

  update public.payments
     set status = 'paid',
         stripe_payment_intent_id = coalesce(p_stripe_payment_intent_id, stripe_payment_intent_id)
   where id = p_payment_id;

  return true;
exception
  when check_violation then
    -- The order's status already moved on (a race, or a delayed/out-of-order
    -- webhook retry) -- validate_order_status_event() rejected the
    -- from_status='awaiting_payment' -> to_status='received' transition.
    -- Caller logs and acknowledges the webhook without marking the payment
    -- paid, exactly as the pre-existing (non-atomic) behavior did.
    return false;
end;
$$;

comment on function mark_order_received_and_paid(uuid, uuid, uuid, text) is
  'Atomically transitions an order to received and its payment to paid in one call (issue #90) -- replaces two separate writes from webhook-service.ts that could leave an order received with its payment still pending if the process crashed between them. Returns false (not an exception) if the order''s status already moved on (race/out-of-order event); any other error propagates.';

revoke all on function mark_order_received_and_paid(uuid, uuid, uuid, text) from public;
grant execute on function mark_order_received_and_paid(uuid, uuid, uuid, text) to service_role;
