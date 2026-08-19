import type { OrderStatus } from "@gastro-saas/domain";

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

/**
 * Customer-safe projection of an order, as returned by the
 * `get_order_status_by_token` RPC (ticket #22, see
 * `supabase/migrations/20260805090000_order_status_guest_lookup.sql`).
 * Deliberately excludes every internal/staff-only field (tenant/cart ids,
 * the guest access token hash itself, `order_status_events.note`/
 * `actor_user_id`) -- see that migration's header for the full rationale.
 */
export interface OrderStatusItemSelectionView {
  name: string;
  priceDeltaCents: number;
}

export interface OrderStatusItemView {
  dishName: string;
  variantName: string | null;
  quantity: number;
  unitPriceCents: number;
  selections: OrderStatusItemSelectionView[];
}

export interface OrderStatusHistoryEntryView {
  status: OrderStatus;
  occurredAt: string;
}

/**
 * This order's own rating, if the guest has already submitted one (ticket
 * #33) -- `null` otherwise. Never any other guest's rating or a tenant-wide
 * aggregate.
 */
export interface OrderRatingSummaryView {
  stars: number;
  comment: string;
  createdAt: string;
}

export interface OrderStatusView {
  orderId: string;
  /**
   * Slug of the tenant that owns this order (see
   * `supabase/migrations/20260808120000_order_status_guest_lookup_tenant_slug.sql`).
   * Deliberately the slug, never `tenant_id` -- callers use this only to
   * verify the order matches the route's `[slug]` segment, not as an
   * identifier to key further lookups off of.
   */
  tenantSlug: string | null;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  tableIdentifier: string | null;
  customerName: string;
  customerNote: string;
  totalCents: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  items: OrderStatusItemView[];
  statusHistory: OrderStatusHistoryEntryView[];
  /** ticket #33 -- null until the guest submits a rating for this order. */
  rating: OrderRatingSummaryView | null;
}
