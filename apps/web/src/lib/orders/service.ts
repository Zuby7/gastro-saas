import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CreateOrderFromCartInput, CreateOrderResult, OrderStatusView } from "./types";

/**
 * Converts a checkout-ready guest cart into an order via the
 * `create_order_from_cart` RPC (see
 * `supabase/migrations/20260804090000_orders_state_machine_and_checkout.sql`).
 * The RPC itself re-verifies the cart belongs to `tenantId` and re-runs the
 * live price/availability recalculation -- this function never passes a
 * client-calculated total, and never assumes the cart is still
 * checkout-ready just because the last render said so.
 *
 * Error messages returned by the RPC are translated into user-facing German
 * copy here rather than passed through raw, per
 * `.claude/rules/backend-api.md` ("never leak raw database errors ... to
 * the client").
 */
export async function createOrderFromCart(
  input: CreateOrderFromCartInput,
): Promise<CreateOrderResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("create_order_from_cart", {
    p_cart_id: input.cartId,
    p_tenant_id: input.tenantId,
    p_fulfillment_type: input.fulfillmentType,
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_table_identifier: input.tableIdentifier,
    p_customer_note: input.customerNote,
    p_guest_access_token_hash: input.guestAccessTokenHash,
  });

  if (error || !data) {
    const message = (error?.message ?? "").toLowerCase();

    if (message.includes("cart not found")) {
      throw new Error("Ihr Warenkorb wurde nicht gefunden. Bitte laden Sie die Seite neu.");
    }
    if (message.includes("cart is empty")) {
      throw new Error("Ihr Warenkorb ist leer.");
    }
    if (message.includes("not ready for checkout")) {
      throw new Error(
        "Ihr Warenkorb enthält nicht mehr verfügbare Artikel. Bitte prüfen Sie Ihren Warenkorb.",
      );
    }
    if (message.includes("not yet supported")) {
      throw new Error("Diese Bestellart wird aktuell nicht unterstützt.");
    }
    if (message.includes("table identifier is required")) {
      throw new Error("Bitte geben Sie eine Tischnummer an.");
    }
    if (message.includes("customer name is required")) {
      throw new Error("Bitte geben Sie Ihren Namen an.");
    }

    throw new Error(
      "Die Bestellung konnte nicht aufgegeben werden. Bitte versuchen Sie es erneut.",
    );
  }

  return data as CreateOrderResult;
}

/**
 * Looks up an order's customer-safe status view purely by its guest access
 * token hash, via the `get_order_status_by_token` RPC (see
 * `supabase/migrations/20260805090000_order_status_guest_lookup.sql`).
 * `tenant_id`/`order_id` are resolved entirely inside the RPC from the hash
 * itself -- this function never passes, and the RPC never accepts, a
 * client-supplied tenant/order id (docs/security/tenant-isolation.md Layer
 * 0). Returns `null` for a wrong/guessed token -- the same, non-distinguishable
 * response as any other lookup miss (ticket #22 acceptance criterion 1);
 * callers must render a generic "not found" state, never a different error
 * for "token malformed" vs. "no such order".
 */
export async function getOrderStatusByToken(
  guestAccessTokenHash: string,
): Promise<OrderStatusView | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("get_order_status_by_token", {
    p_guest_access_token_hash: guestAccessTokenHash,
  });

  if (error || !data) {
    return null;
  }

  return data as OrderStatusView;
}
