"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { readCartToken } from "@/lib/cart/cookie";
import { hashCartToken } from "@/lib/cart/token";
import {
  addCartItem,
  getCartView,
  getOrCreateCartId,
  removeCartItem,
  resolveGuestCartContext,
  resolveTenantIdBySlug,
  updateCartItemQuantity,
} from "@/lib/cart/service";
import type { CartView } from "@/lib/cart/types";
import { recordAddToCartEventOnce } from "@/lib/menu-view/service";
import { AddToCartSchema, RemoveCartItemSchema, UpdateCartItemQuantitySchema } from "./schemas";

export interface CartActionState {
  error?: string;
  cart?: CartView;
}

/**
 * `tenantSlug` is always the first (bound) argument -- callers bind it via
 * `addToCartAction.bind(null, tenantSlug)` from the Server Component that
 * already knows the route's slug, so it is never read from client-supplied
 * form data. This closes off even a cosmetic "tamper with a hidden field"
 * surface, on top of the fact that every downstream call still re-resolves
 * `tenant_id` from the slug and every cart RPC re-verifies cart ownership
 * server-side regardless.
 */
export async function addToCartAction(
  tenantSlug: string,
  _prevState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const parsed = AddToCartSchema.safeParse({
    dishId: formData.get("dishId"),
    dishVariantId: formData.get("dishVariantId") ?? "",
    quantity: formData.get("quantity") ?? "1",
    optionIds: formData.get("optionIds") ?? "",
  });

  if (!parsed.success) {
    return { error: "Bitte prüfen Sie Ihre Auswahl." };
  }

  try {
    const { tenantId, cartId } = await resolveGuestCartContext(tenantSlug);
    const cart = await addCartItem({
      cartId,
      tenantId,
      dishId: parsed.data.dishId,
      dishVariantId: parsed.data.dishVariantId,
      quantity: parsed.data.quantity,
      optionIds: parsed.data.optionIds,
    });

    revalidatePath(`/r/${tenantSlug}/cart`);

    // Ticket #120 part B: record a rate-limited/deduplicated add_to_cart
    // event only after the cart mutation itself has already succeeded --
    // never blocks or fails the cart action on an analytics error. Not
    // awaited: this is a user-blocking mutation (the cart action's caller is
    // waiting on the response to update the UI), and `recordAddToCartEventOnce`
    // already swallows every error internally, so there is nothing useful to
    // await here (PR #136 Opus finding: this used to add its round trip's
    // latency directly to the cart mutation). `after()` (not a bare `void`)
    // registers it with the platform's request lifecycle so it's still
    // guaranteed to run to completion after the response is sent, even on a
    // serverless/edge runtime that might otherwise freeze/recycle the
    // process right after responding -- same rationale as
    // apps/web/src/app/login/actions.ts's `after(() => recordFailedLoginAttempt(...))`.
    after(() => recordAddToCartEventOnce(tenantSlug, tenantId, parsed.data.dishId));

    return { cart };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unbekannter Fehler." };
  }
}

export async function updateCartItemQuantityAction(
  tenantSlug: string,
  _prevState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const parsed = UpdateCartItemQuantitySchema.safeParse({
    cartItemId: formData.get("cartItemId"),
    quantity: formData.get("quantity"),
  });

  if (!parsed.success) {
    return { error: "Ungültige Anfrage." };
  }

  try {
    const { tenantId, cartId } = await resolveGuestCartContext(tenantSlug);
    const cart = await updateCartItemQuantity(
      cartId,
      tenantId,
      parsed.data.cartItemId,
      parsed.data.quantity,
    );

    revalidatePath(`/r/${tenantSlug}/cart`);
    return { cart };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unbekannter Fehler." };
  }
}

export async function removeCartItemAction(
  tenantSlug: string,
  _prevState: CartActionState,
  formData: FormData,
): Promise<CartActionState> {
  const parsed = RemoveCartItemSchema.safeParse({ cartItemId: formData.get("cartItemId") });

  if (!parsed.success) {
    return { error: "Ungültige Anfrage." };
  }

  try {
    const { tenantId, cartId } = await resolveGuestCartContext(tenantSlug);
    const cart = await removeCartItem(cartId, tenantId, parsed.data.cartItemId);

    revalidatePath(`/r/${tenantSlug}/cart`);
    return { cart };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unbekannter Fehler." };
  }
}

/** Server Component helper: loads the current cart view without mutating it (creates no cart if none exists yet). */
export async function loadCartViewForDisplay(tenantSlug: string): Promise<CartView | null> {
  const tenantId = await resolveTenantIdBySlug(tenantSlug);
  const token = await readCartToken(tenantSlug);
  if (!tenantId || !token) {
    return null;
  }

  const cartId = await getOrCreateCartId(tenantId, hashCartToken(token));
  return getCartView(cartId, tenantId);
}
