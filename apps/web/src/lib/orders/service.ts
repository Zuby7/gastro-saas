import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CreateOrderFromCartInput, CreateOrderResult, OrderStatusView } from "./types";

/**
 * Marks an error message as already translated, safe, actionable German
 * copy -- never a raw internal/DB/Stripe error -- so callers (issue #96,
 * `apps/web/src/app/r/[slug]/checkout/actions.ts`) can pass its `.message`
 * straight through to the guest while still falling back to one generic
 * message for anything NOT thrown as this type (e.g. `payments/service.ts`'s
 * internal English debug strings, which are never safe to display).
 */
export class CheckoutDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutDomainError";
  }
}

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
 * the client"), and thrown as `CheckoutDomainError` so the caller knows
 * these specific messages are safe to show as-is.
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
      throw new CheckoutDomainError(
        "Ihr Warenkorb wurde nicht gefunden. Bitte laden Sie die Seite neu.",
      );
    }
    if (message.includes("cart is empty")) {
      throw new CheckoutDomainError("Ihr Warenkorb ist leer.");
    }
    if (message.includes("not ready for checkout")) {
      throw new CheckoutDomainError(
        "Ihr Warenkorb enthält nicht mehr verfügbare Artikel. Bitte prüfen Sie Ihren Warenkorb.",
      );
    }
    if (message.includes("not yet supported")) {
      throw new CheckoutDomainError("Diese Bestellart wird aktuell nicht unterstützt.");
    }
    if (message.includes("table identifier is required")) {
      throw new CheckoutDomainError("Bitte geben Sie eine Tischnummer an.");
    }
    if (message.includes("customer name is required")) {
      throw new CheckoutDomainError("Bitte geben Sie Ihren Namen an.");
    }

    // Anything else is NOT a known, safe-to-display domain error -- a plain
    // Error here (not CheckoutDomainError) so the caller's catch-all falls
    // back to its own generic message rather than showing this raw RPC
    // error text.
    throw new Error(`create_order_from_cart failed: ${error?.message ?? "no data returned"}`);
  }

  return data as CreateOrderResult;
}

/**
 * Looks up an order's customer-safe status view purely by its guest access
 * token hash, via the `get_order_status_by_token` RPC (see
 * `supabase/migrations/20260805090000_order_status_guest_lookup.sql` and
 * `supabase/migrations/20260808120000_order_status_guest_lookup_tenant_slug.sql`).
 * `tenant_id`/`order_id` are resolved entirely inside the RPC from the hash
 * itself -- this function never passes, and the RPC never accepts, a
 * client-supplied tenant/order id (docs/security/tenant-isolation.md Layer
 * 0). Returns `null` for a wrong/guessed token -- the same, non-distinguishable
 * response as any other lookup miss (ticket #22 acceptance criterion 1);
 * callers must render a generic "not found" state, never a different error
 * for "token malformed" vs. "no such order". The returned view's
 * `tenantSlug` must also be checked by callers against the route's `[slug]`
 * segment (same generic "not found" state on mismatch) -- see the page
 * component for that check.
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
