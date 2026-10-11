import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  MOLLIE_PAYMENT_ID_PATTERN,
  handleMolliePaymentWebhook,
} from "@/lib/payments/mollie-webhook-service";

/**
 * Mollie payment webhook (issue #195, ADR-0004). Mollie POSTs only
 * `id=<paymentId>` (form-encoded) and signs nothing, so this route trusts
 * nothing in the request: `handleMolliePaymentWebhook` re-fetches the payment
 * from Mollie with the owning restaurant's token and verifies it.
 *
 * Responses are deliberately uniform: malformed or unknown ids get the same
 * neutral 200 as a processed one, so the endpoint cannot be used to probe
 * which payment ids exist. 5xx only for genuinely unexpected failures, so
 * Mollie retries.
 */
export async function POST(request: NextRequest) {
  let id: string | null = null;
  try {
    const form = await request.formData();
    const value = form.get("id");
    id = typeof value === "string" ? value : null;
  } catch {
    id = null;
  }

  if (!id || !MOLLIE_PAYMENT_ID_PATTERN.test(id)) {
    return NextResponse.json({ received: true });
  }

  try {
    await handleMolliePaymentWebhook(createSupabaseAdminClient(), id);
  } catch (error) {
    console.error(
      "[mollie-webhook] unexpected error processing payment",
      id,
      error instanceof Error ? error.name : "error",
    );
    return new NextResponse("Failed to process webhook", { status: 500 });
  }

  return NextResponse.json({ received: true });
}
