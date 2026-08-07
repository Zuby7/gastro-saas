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
    const admin = createSupabaseAdminClient();
    const rateLimitStore = createSupabaseRateLimitStore(admin);
    const ip = await getClientIp();
    const { limited, attemptId } = await reserveAndCheckRateLimit(rateLimitStore, {
      scope: "checkout",
      ip,
      email: cartId,
      maxAttempts: 10,
      windowSeconds: 60 * 60,
    });

    if (limited) {
      return {
        error: "Zu viele Bestellversuche. Bitte versuchen Sie es später erneut.",
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

    await rateLimitStore.markSucceeded(attemptId);
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

    // The raw guest access token is embedded in this redirect URL and in the
    // httpOnly cookie written above -- it is never returned in the action's
    // state/JSON payload beyond this one-time redirect.
    redirectTarget = `/r/${tenantSlug}/orders/${guestAccessToken}`;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unbekannter Fehler." };
  }

  redirect(redirectTarget);
}
