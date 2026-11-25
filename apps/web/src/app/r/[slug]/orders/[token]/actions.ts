"use server";

import { redirect } from "next/navigation";
import { getClientIp } from "@/lib/auth/client-ip";
import { reserveAndCheckRateLimit } from "@/lib/auth/rate-limit";
import { createSupabaseRateLimitStore } from "@/lib/auth/supabase-rate-limit-store";
import { resolveTenantIdBySlug } from "@/lib/cart/service";
import { getOrderStatusByToken } from "@/lib/orders/service";
import { hashOrderAccessToken } from "@/lib/orders/token";
import { resumeCheckoutSessionForOrder } from "@/lib/payments/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

export interface RetryPaymentState {
  error?: string;
  /** `confirming`: payment already completed at Stripe; `expired`: session over, order again. */
  outcome?: "confirming" | "expired";
}

/** Per (ip, order) and hour -- retrying payment is a handful of clicks at most. */
const RETRY_PAYMENT_MAX_ATTEMPTS_PER_ORDER = 10;
const RETRY_PAYMENT_MAX_ATTEMPTS_PER_IP = 120;

/**
 * "Erneut bezahlen" after the guest cancelled on (or returned from) Stripe's
 * hosted page. Authorization is possession of the raw guest token, exactly
 * like `pollOrderStatus`: the order is resolved from the token hash and its
 * tenant slug must match the route's. Nothing is read from the
 * form: the action only REUSES the order's still-open Stripe session
 * (`resumeCheckoutSessionForOrder`) and never creates a second one. A
 * retrieve failure is a retryable error. Only a verified webhook ever marks
 * the order paid.
 *
 * `tenantSlug` and `rawToken` are bound server-side (never form fields).
 */
export async function retryPaymentAction(
  tenantSlug: string,
  rawToken: string,
  _prevState: RetryPaymentState,
  _formData: FormData,
): Promise<RetryPaymentState> {
  let redirectTarget: string | null = null;

  try {
    const order = await getOrderStatusByToken(hashOrderAccessToken(rawToken));

    if (!order || order.tenantSlug !== tenantSlug) {
      return { error: "Bestellung nicht gefunden." };
    }

    if (order.status !== "awaiting_payment") {
      return { error: "Diese Bestellung wartet nicht mehr auf eine Zahlung." };
    }

    const tenantId = await resolveTenantIdBySlug(tenantSlug);
    if (!tenantId) {
      return { error: "Bestellung nicht gefunden." };
    }

    const admin = createSupabaseAdminClient();
    const { limited } = await reserveAndCheckRateLimit(createSupabaseRateLimitStore(admin), {
      scope: "checkout",
      ip: await getClientIp(),
      email: order.orderId,
      maxAttempts: RETRY_PAYMENT_MAX_ATTEMPTS_PER_ORDER,
      maxIpAttempts: RETRY_PAYMENT_MAX_ATTEMPTS_PER_IP,
      windowSeconds: 60 * 60,
    });
    if (limited) {
      return { error: "Zu viele Versuche. Bitte versuchen Sie es später erneut." };
    }

    const result = await resumeCheckoutSessionForOrder({
      tenantId,
      tenantSlug,
      orderId: order.orderId,
      guestAccessToken: rawToken,
    });

    if (result.kind === "complete") {
      return { outcome: "confirming" };
    }
    if (result.kind === "expired") {
      return { outcome: "expired" };
    }
    redirectTarget = result.checkoutUrl;
  } catch (error) {
    console.error("[orders] retryPaymentAction failed", error);
    return { error: "Die Zahlung konnte nicht gestartet werden. Bitte versuchen Sie es erneut." };
  }

  redirect(redirectTarget);
}
