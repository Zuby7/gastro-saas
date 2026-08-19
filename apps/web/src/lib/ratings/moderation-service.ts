import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ModerateRatingResult,
  ModerationQueueRatingView,
  RatingModerationStatus,
} from "./types";

export class RatingNotFoundError extends Error {
  constructor(message = "Diese Bewertung wurde nicht gefunden.") {
    super(message);
    this.name = "RatingNotFoundError";
  }
}

interface RawModerationQueueRow {
  rating_id: string;
  stars: number;
  comment: string;
  rated_at: string;
  status: RatingModerationStatus;
  moderated_by_user_id: string | null;
  moderated_at: string | null;
}

/**
 * Admin moderation list read (ticket #34). Caller must already have called
 * `requireTenantPermission(supabase, tenantId, 'reviews.read')` --
 * `list_tenant_ratings_for_moderation()` independently re-checks the same
 * permission server-side (two enforcement layers, matching this repo's
 * `orders.manage`/`transition_order_status()` precedent).
 */
export async function listTenantRatingsForModeration(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<ModerationQueueRatingView[]> {
  const { data, error } = await supabase.rpc("list_tenant_ratings_for_moderation", {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw error;
  }

  return ((data ?? []) as RawModerationQueueRow[]).map((row) => ({
    ratingId: row.rating_id,
    stars: row.stars,
    comment: row.comment,
    ratedAt: row.rated_at,
    status: row.status,
    moderatedByUserId: row.moderated_by_user_id,
    moderatedAt: row.moderated_at,
  }));
}

/**
 * Staff-facing moderation status change (ticket #34). Caller must already
 * have called `requireTenantPermission(supabase, tenantId, 'reviews.moderate')`
 * -- `moderate_rating()` independently re-checks the same permission
 * server-side. Every status change is audited by
 * `audit_rating_moderation_change()` (see the migration), not by this
 * function -- it never inserts into `audit_logs` itself.
 */
export async function moderateRating(
  supabase: SupabaseClient,
  input: { tenantId: string; ratingId: string; status: RatingModerationStatus },
): Promise<ModerateRatingResult> {
  const { data, error } = await supabase.rpc("moderate_rating", {
    p_tenant_id: input.tenantId,
    p_rating_id: input.ratingId,
    p_status: input.status,
  });

  if (error || !data) {
    const message = (error?.message ?? "").toLowerCase();

    if (message.includes("rating not found")) {
      throw new RatingNotFoundError();
    }

    // Anything else is NOT a known, safe-to-display domain error -- fall
    // back to a plain Error so the caller's catch-all shows one generic
    // message instead of a raw RPC error (.claude/rules/backend-api.md).
    throw new Error(`moderate_rating failed: ${error?.message ?? "no data returned"}`);
  }

  return data as ModerateRatingResult;
}
