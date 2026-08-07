"use server";

import { getOrderStatusByToken } from "@/lib/orders/service";
import { hashOrderAccessToken } from "@/lib/orders/token";
import type { OrderStatus } from "@gastro-saas/domain";

export interface OrderStatusPoll {
  status: OrderStatus;
}

/**
 * Polled by the client-side `OrderStatusLive` component (see
 * `./order-status-live.tsx`) to make the order-status page's `aria-live`
 * region a real accessibility feature (Opus epic-6 batch review finding 1)
 * rather than a decorative one on a page that otherwise never re-fetches
 * after initial render.
 *
 * Deliberately returns only `{ status }` -- the polling loop only needs to
 * detect a status change to update the announced text; it re-uses the same
 * lookup/authorization path as the initial page render (raw token -> hash ->
 * `get_order_status_by_token`, tenant/order resolved purely from the token,
 * never a client-supplied id) rather than a lighter-weight bespoke query, to
 * avoid a second, differently-shaped authorization surface for the same
 * data.
 *
 * Also re-verifies the resolved order's owning tenant slug matches
 * `tenantSlug` (finding 3) -- a token that stops matching (or a wrong slug
 * passed in) yields `null`, the same as an invalid/expired token, so the
 * client stops polling/treats it as no-longer-found rather than leaking
 * which case it was.
 */
export async function pollOrderStatus(
  tenantSlug: string,
  rawToken: string,
): Promise<OrderStatusPoll | null> {
  const order = await getOrderStatusByToken(hashOrderAccessToken(rawToken));

  if (!order || order.tenantSlug !== tenantSlug) {
    return null;
  }

  return { status: order.status };
}
