"use server";

import { revalidatePath } from "next/cache";
import { readCartToken, writeCartTokenCookie } from "@/lib/cart/cookie";
import { createCartToken, hashCartToken } from "@/lib/cart/token";
import {
  addCartItem,
  getCartView,
  getOrCreateCartId,
  removeCartItem,
  resolveTenantIdBySlug,
  updateCartItemQuantity,
} from "@/lib/cart/service";
import type { CartView } from "@/lib/cart/types";
import { AddToCartSchema, RemoveCartItemSchema, UpdateCartItemQuantitySchema } from "./schemas";

export interface CartActionState {
  error?: string;
  cart?: CartView;
}

/**
 * Resolves (or creates) the calling guest's cart for `tenantSlug`,
 * server-side: reads the httpOnly cart cookie if present, otherwise mints a
 * fresh opaque token and writes it back. `tenant_id` always comes from this
 * slug lookup, never from a client-supplied value -- see
 * `docs/security/tenant-isolation.md` Layer 0.
 */
async function resolveGuestCartContext(tenantSlug: string) {
  const tenantId = await resolveTenantIdBySlug(tenantSlug);
  if (!tenantId) {
    throw new Error("Restaurant nicht gefunden.");
  }

  let token = await readCartToken(tenantSlug);
  if (!token) {
    token = createCartToken();
    await writeCartTokenCookie(tenantSlug, token);
  }

  const cartId = await getOrCreateCartId(tenantId, hashCartToken(token));
  return { tenantId, cartId };
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
