import { readCartToken } from "@/lib/cart/cookie";
import { getCartView, resolveTenantIdBySlug } from "@/lib/cart/service";
import type { CartView } from "@/lib/cart/types";
import { sha256Hex } from "@/lib/security/opaque-token";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Server Component helper: loads the current guest cart view for display.
 * LOOKUP-ONLY: a GET never creates a cart row (creation stays in
 * `resolveGuestCartContext`, reached only from mutating cart actions).
 * Lives outside the "use server" actions file so it is not exposed as a
 * callable Server Action endpoint. `tenant_id` always comes from the route
 * slug, and the cart is matched on (tenant_id, SHA-256 of the cookie token).
 *
 * `knownTenantId` lets a caller that already resolved the tenant skip the
 * second lookup.
 */
export async function loadCartViewForDisplay(
  tenantSlug: string,
  knownTenantId?: string | null,
): Promise<CartView | null> {
  const token = await readCartToken(tenantSlug);
  if (!token) {
    return null;
  }

  const tenantId = knownTenantId ?? (await resolveTenantIdBySlug(tenantSlug));
  if (!tenantId) {
    return null;
  }

  const supabase = createSupabaseAdminClient();
  const { data } = await supabase
    .from("carts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("cart_token_hash", sha256Hex(token))
    .maybeSingle<{ id: string }>();

  if (!data) {
    return null;
  }

  return getCartView(data.id, tenantId);
}
