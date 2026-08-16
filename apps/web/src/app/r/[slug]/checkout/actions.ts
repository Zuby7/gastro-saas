"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getClientIp } from "@/lib/auth/client-ip";
import { reserveAndCheckRateLimit } from "@/lib/auth/rate-limit";
import { createSupabaseRateLimitStore } from "@/lib/auth/supabase-rate-limit-store";
import { recordOrderAuditEvent } from "@/lib/audit/record-order-audit-event";
import { resolveGuestCartContext } from "@/lib/cart/service";
import { writeOrderAccessTokenCookie } from "@/lib/orders/cookie";
import { createOrderFromCart } from "@/lib/orders/service";
import { createOrderAccessToken, hashOrderAccessToken } from "@/lib/orders/token";
import { createCheckoutSessionForOrder, isTenantChargeReady } from "@/lib/payments/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { CheckoutSchema } from "./schemas";

export interface CheckoutFormState {
  error?: string;
}

/**
 * `tenantSlug` is always the first (bound) argument, mirroring
 * `apps/web/src/app/r/[slug]/cart/actions.ts`'s `addToCartAction` -- never
 * read from client-supplied form data.
 */
export async function checkoutAction(
  tenantSlug: string,
  _prevState: CheckoutFormState,
  formData: FormData,
): Promise<CheckoutFormState> {
  const parsed = CheckoutSchema.safeParse({
    fulfillmentType: formData.get("fulfillmentType"),
    customerName: formData.get("customerName"),
    customerPhone: formData.get("customerPhone") ?? "",
    tableIdentifier: formData.get("tableIdentifier") ?? "",
    customerNote: formData.get("customerNote") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Bitte prüfen Sie Ihre Eingaben." };
  }

  const customerPhone = parsed.data.fulfillmentType === "pickup" ? parsed.data.customerPhone : null;
  const tableIdentifier =
    parsed.data.fulfillmentType === "table" ? parsed.data.tableIdentifier : null;

  // `redirectTarget` is set inside the try block on success and the actual
  // `redirect()` call happens afterwards, outside the try/catch -- `redirect()`
  // works by throwing a special NEXT_REDIRECT error internally, which a
  // generic `catch (error)` below would otherwise swallow and misreport as a
  // normal checkout failure.
  let redirectTarget: string | null = null;

  try {
    const { tenantId, cartId } = await resolveGuestCartContext(tenantSlug);

    // Rate-limit the checkout endpoint per `.claude/rules/backend-api.md`
    // ("rate-limit auth and checkout endpoints"), reusing the exact same
    // atomic reserve-and-count mechanism the auth flows already use rather
    // than inventing a second one. Guest checkout has no email identity, so
    // the (ip, *) bucket is keyed on the cart id instead -- still meaningful
    // (one guest identity per cart) while the ip-only bucket independently
    // caps any single source regardless of how many carts it cycles through.
    //
    // Unlike login/register, `markSucceeded()` is deliberately NEVER called
    // for this scope (Opus epic-6 batch review, finding 2): the auth flows'
    // "only failed attempts count" design exists because their abuse case is
    // credential brute-forcing, where a legitimate successful login should
    // not count against the limit. Checkout's abuse case is the opposite --
    // order/spam abuse -- so a *successful* checkout is exactly the thing
    // that must count toward the limit, otherwise a bot could place
    // unlimited real orders as long as each one succeeds. Every checkout
    // attempt therefore counts, success or failure.
    //
    // 10 attempts/hour per IP (and per (ip, cart) pair) is generous enough
    // for a real guest's normal use (at most a handful of orders per visit)
    // while still bounding automated abuse to a small, easily-noticed volume
    // per hour -- unlike the login scope's much lower threshold, which is
    // tuned for credential-guessing rather than "how many genuine orders
    // could one person place."
    const admin = createSupabaseAdminClient();
    const rateLimitStore = createSupabaseRateLimitStore(admin);
    const ip = await getClientIp();
    const { limited } = await reserveAndCheckRateLimit(rateLimitStore, {
      scope: "checkout",
      ip,
      email: cartId,
      maxAttempts: 10,
      // Explicit and deliberately equal to maxAttempts (no widening) -- the
      // shared-IP/CGNAT concern that widens the login/invite scopes was
      // never scoped to checkout.
      maxIpAttempts: 10,
      windowSeconds: 60 * 60,
    });

    if (limited) {
      return {
        error: "Zu viele Bestellversuche. Bitte versuchen Sie es später erneut.",
      };
    }

    // Reject checkout up front if the tenant's Stripe Connect account isn't
    // ready to accept charges (ticket #23's `payment_accounts`, ADR-0002) --
    // checked *before* creating the order so a not-yet-payable tenant can
    // never end up with an order stuck in `awaiting_payment` with no way to
    // ever pay it off. `createCheckoutSessionForOrder` below re-checks this
    // again immediately before payment creation, and the DB-level
    // `ensure_payment_matches_order()` trigger re-checks it a third,
    // unbypassable time on INSERT.
    if (!(await isTenantChargeReady(tenantId))) {
      return {
        error:
          "Dieses Restaurant kann derzeit keine Kartenzahlungen entgegennehmen. Bitte versuchen Sie es später erneut.",
      };
    }

    const guestAccessToken = createOrderAccessToken();

    const order = await createOrderFromCart({
      tenantId,
      cartId,
      guestAccessTokenHash: hashOrderAccessToken(guestAccessToken),
      fulfillmentType: parsed.data.fulfillmentType,
      customerName: parsed.data.customerName,
      customerPhone,
      tableIdentifier,
      customerNote: parsed.data.customerNote,
    });

    await writeOrderAccessTokenCookie(tenantSlug, guestAccessToken);

    await recordOrderAuditEvent(admin, {
      tenantId,
      action: "order.created",
      targetType: "order",
      targetId: order.orderId,
      metadata: { fulfillmentType: parsed.data.fulfillmentType, totalCents: order.totalCents },
    });

    revalidatePath(`/r/${tenantSlug}/cart`);
    revalidatePath(`/r/${tenantSlug}/checkout`);

    // Never redirect straight to the order-status page: the customer must
    // land on Stripe's own hosted payment page first. Reaching Stripe's
    // success_url later is never treated as proof of payment
    // (.claude/rules/payments.md) -- only ticket #25's verified webhook ever
    // transitions the order to "paid"; the order-status page (ticket #22)
    // renders whatever the order's real, webhook-driven status is,
    // regardless of whether the guest completed or abandoned Stripe
    // checkout.
    const { checkoutUrl } = await createCheckoutSessionForOrder({
      tenantId,
      tenantSlug,
      orderId: order.orderId,
      guestAccessToken,
    });

    // The raw guest access token is embedded in Stripe's success/cancel
    // return URLs (built inside createCheckoutSessionForOrder) and in the
    // httpOnly cookie written above -- it is never returned in the action's
    // state/JSON payload beyond this one-time redirect.
    redirectTarget = checkoutUrl;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unbekannter Fehler." };
  }

  redirect(redirectTarget);
}
