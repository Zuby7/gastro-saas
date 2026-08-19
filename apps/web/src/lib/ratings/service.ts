import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { SubmitOrderRatingInput, SubmitOrderRatingResult } from "./types";

/**
 * Marks an error message as already translated, safe, actionable German
 * copy -- never a raw internal/DB error -- mirroring
 * `apps/web/src/lib/orders/service.ts`'s `CheckoutDomainError` precedent
 * exactly.
 */
export class RatingDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RatingDomainError";
  }
}

/**
 * Submits a guest rating via the `submit_order_rating` RPC (see
 * `supabase/migrations/20260819090000_ratings_guest_submission.sql`).
 * `tenant_id`/`order_id` are resolved entirely inside the RPC from the
 * guest access token hash -- this function never passes, and the RPC never
 * accepts, a client-supplied tenant/order id
 * (docs/security/tenant-isolation.md Layer 0).
 */
export async function submitOrderRating(
  input: SubmitOrderRatingInput,
): Promise<SubmitOrderRatingResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("submit_order_rating", {
    p_guest_access_token_hash: input.guestAccessTokenHash,
    p_stars: input.stars,
    p_comment: input.comment,
  });

  if (error || !data) {
    const message = (error?.message ?? "").toLowerCase();

    if (message.includes("order not found")) {
      throw new RatingDomainError(
        "Für diesen Link konnte keine Bestellung gefunden werden. Bitte prüfen Sie den Link aus Ihrer Bestellbestätigung.",
      );
    }
    if (message.includes("not yet completed")) {
      throw new RatingDomainError(
        "Diese Bestellung kann erst bewertet werden, sobald sie abgeschlossen ist.",
      );
    }
    if (message.includes("already been rated")) {
      throw new RatingDomainError("Diese Bestellung wurde bereits bewertet.");
    }
    if (message.includes("stars must be between")) {
      throw new RatingDomainError("Bitte wählen Sie eine Bewertung von 1 bis 5 Sternen.");
    }
    if (message.includes("comment is too long")) {
      throw new RatingDomainError("Der Kommentar ist zu lang.");
    }

    // Anything else is NOT a known, safe-to-display domain error -- fall
    // back to a plain Error so the caller's catch-all shows one generic
    // message instead of a raw RPC error (.claude/rules/backend-api.md).
    throw new Error(`submit_order_rating failed: ${error?.message ?? "no data returned"}`);
  }

  return data as SubmitOrderRatingResult;
}
