import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Customer-facing label of the provider that settled an order, for the
 * receipt (issue #195). Returns "PayPal" for a paid Mollie payment and null
 * otherwise (Stripe keeps the generic "Online bezahlt" wording). Never throws:
 * a lookup failure just falls back to the generic wording. The order id is
 * only ever the one resolved from the guest's own order token.
 */
export async function getPaidPaymentMethodLabel(orderId: string): Promise<string | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("payments")
      .select("provider")
      .eq("order_id", orderId)
      .eq("status", "paid")
      .limit(1)
      .maybeSingle<{ provider: string }>();
    return data?.provider === "mollie" ? "PayPal" : null;
  } catch {
    return null;
  }
}
