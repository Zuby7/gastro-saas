import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus } from "@gastro-saas/domain";

export class OrderNotFoundError extends Error {
  constructor(message = "Diese Bestellung wurde nicht gefunden.") {
    super(message);
    this.name = "OrderNotFoundError";
  }
}

export class InvalidOrderStatusTransitionError extends Error {
  constructor(message = "Dieser Statuswechsel ist nicht zulässig.") {
    super(message);
    this.name = "InvalidOrderStatusTransitionError";
  }
}

export interface TransitionOrderStatusInput {
  tenantId: string;
  orderId: string;
  toStatus: OrderStatus;
}

interface TransitionOrderStatusRpcResult {
  orderId: string;
  status: OrderStatus;
}

/**
 * Staff-facing order status transition (Epic 8, ticket #28) -- the kitchen
 * workflow's `received -> accepted -> preparing -> ready -> completed`
 * (or `-> cancelled`) lifecycle. Caller must already have verified
 * `orders.manage` (see module callers) -- this function's own
 * `transition_order_status()` RPC independently re-checks the same
 * permission server-side (two enforcement layers, matching this repo's
 * `issueRefundForOrder`/`payments.refund` precedent).
 *
 * Never writes `orders.status` directly: the RPC appends an
 * `order_status_events` row, validated by the existing
 * `validate_order_status_event()` trigger (ticket #21) -- that trigger, not
 * this function, is the actual source-of-truth enforcement for which
 * transitions are valid.
 */
export async function transitionOrderStatus(
  supabase: SupabaseClient,
  input: TransitionOrderStatusInput,
): Promise<OrderStatus> {
  const { data, error } = await supabase.rpc("transition_order_status", {
    p_tenant_id: input.tenantId,
    p_order_id: input.orderId,
    p_to_status: input.toStatus,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.toLowerCase().includes("invalid order status transition")) {
      throw new InvalidOrderStatusTransitionError(message);
    }
    if (message.toLowerCase().includes("order not found")) {
      throw new OrderNotFoundError();
    }
    throw error;
  }

  return (data as TransitionOrderStatusRpcResult).status;
}
