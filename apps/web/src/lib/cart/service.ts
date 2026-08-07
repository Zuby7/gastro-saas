import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CartView } from "./types";

/**
 * Resolves a public route's tenant slug into a `tenant_id`, server-side,
 * before any cart read/write -- per
 * `docs/security/tenant-isolation.md` Layer 0, tenant context for a guest
 * path always comes from the route slug, never a client-supplied id. Uses
 * the service-role client (bypasses RLS) since there is no guest session to
 * scope a normal `authenticated` read to; the query itself is narrow
 * (single row, by unique slug), matching the "dedicated narrow query
 * function" discipline already used by `getPublicMenu`.
 */
export async function resolveTenantIdBySlug(tenantSlug: string): Promise<string | null> {
  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .maybeSingle<{ id: string }>();

  return data?.id ?? null;
}

export async function getOrCreateCartId(tenantId: string, cartTokenHash: string): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("get_or_create_cart", {
    p_tenant_id: tenantId,
    p_cart_token_hash: cartTokenHash,
  });

  if (error || !data) {
    throw new Error("Der Warenkorb konnte nicht geladen werden.");
  }

  return data as string;
}

export async function getCartView(cartId: string, tenantId: string): Promise<CartView> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("get_cart_view", {
    p_cart_id: cartId,
    p_tenant_id: tenantId,
  });

  if (error || !data) {
    throw new Error("Der Warenkorb konnte nicht geladen werden.");
  }

  return data as CartView;
}

export interface AddCartItemInput {
  cartId: string;
  tenantId: string;
  dishId: string;
  dishVariantId: string | null;
  quantity: number;
  optionIds: string[];
}

export async function addCartItem(input: AddCartItemInput): Promise<CartView> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("add_cart_item", {
    p_cart_id: input.cartId,
    p_tenant_id: input.tenantId,
    p_dish_id: input.dishId,
    p_dish_variant_id: input.dishVariantId,
    p_quantity: input.quantity,
    p_option_ids: input.optionIds,
  });

  if (error) {
    throw new Error(
      error.message.toLowerCase().includes("no longer available")
        ? "Dieses Gericht ist leider nicht mehr verfügbar."
        : "Der Artikel konnte nicht zum Warenkorb hinzugefügt werden.",
    );
  }

  return data as CartView;
}

export async function updateCartItemQuantity(
  cartId: string,
  tenantId: string,
  cartItemId: string,
  quantity: number,
): Promise<CartView> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("update_cart_item_quantity", {
    p_cart_id: cartId,
    p_tenant_id: tenantId,
    p_cart_item_id: cartItemId,
    p_quantity: quantity,
  });

  if (error || !data) {
    throw new Error("Die Menge konnte nicht aktualisiert werden.");
  }

  return data as CartView;
}

export async function removeCartItem(
  cartId: string,
  tenantId: string,
  cartItemId: string,
): Promise<CartView> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("remove_cart_item", {
    p_cart_id: cartId,
    p_tenant_id: tenantId,
    p_cart_item_id: cartItemId,
  });

  if (error || !data) {
    throw new Error("Der Artikel konnte nicht entfernt werden.");
  }

  return data as CartView;
}
