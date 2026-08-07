/**
 * The two fulfillment types this ticket supports. `delivery` is a
 * feature-flag placeholder at the database level (see the
 * `fulfillment_type` check constraint in
 * `supabase/migrations/20260804090000_orders_state_machine_and_checkout.sql`)
 * but is not offered anywhere in the application layer yet -- explicit
 * non-goal of ticket #21.
 */
export type FulfillmentType = "pickup" | "table";

export interface CreateOrderFromCartInput {
  tenantId: string;
  cartId: string;
  guestAccessTokenHash: string;
  fulfillmentType: FulfillmentType;
  customerName: string;
  customerPhone: string | null;
  tableIdentifier: string | null;
  customerNote: string;
}

/**
 * Shape returned by the `create_order_from_cart` RPC. Deliberately minimal
 * -- ticket #22's guest-facing order-status page owns rendering full order
 * details; this ticket only needs to confirm success and hand back enough
 * identifying info (`orderId`) for that future page to build on.
 */
export interface CreateOrderResult {
  orderId: string;
  status: "awaiting_payment";
  totalCents: number;
  currency: string;
}
