"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { RatingNotFoundError, moderateRating } from "@/lib/ratings/moderation-service";
import { ModerateRatingSchema } from "@/lib/ratings/schemas";
import type { RatingModerationStatus } from "@/lib/ratings/types";

export interface ModerateRatingActionResult {
  error?: string;
  status?: RatingModerationStatus;
}

/**
 * Server action backing the moderation list's status-change buttons (ticket
 * #34). Gated on `reviews.moderate` -- both here (`requireTenantPermission`)
 * and independently by `moderate_rating()`'s own re-check, matching this
 * repo's "two enforcement layers" standard for `transitionOrderStatusAction`
 * in `apps/web/src/app/account/orders/actions.ts`.
 *
 * Deliberately re-resolves `tenantId` from the caller's own session
 * membership on every call -- never trusts a client-supplied tenant id, even
 * though the client already knows which tenant's queue it's viewing.
 */
export async function moderateRatingAction(
  ratingId: string,
  status: RatingModerationStatus,
): Promise<ModerateRatingActionResult> {
  const parsed = ModerateRatingSchema.safeParse({ ratingId, status });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sie sind nicht angemeldet." };
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return { error: "Sie sind noch keinem Restaurant zugeordnet." };
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "reviews.moderate");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, Bewertungen zu moderieren.",
      };
    }
    throw error;
  }

  try {
    const result = await moderateRating(supabase, {
      tenantId: membership.tenantId,
      ratingId: parsed.data.ratingId,
      status: parsed.data.status,
    });

    revalidatePath("/account/reviews");
    return { status: result.status };
  } catch (error) {
    if (error instanceof RatingNotFoundError) {
      return { error: error.message };
    }
    // Ticket #121, Epic-10 Opus review finding 3: log server-side, matching
    // `submitRatingAction`'s catch-all (`apps/web/src/app/r/[slug]/orders/[token]/rating-actions.ts`)
    // -- an unexpected failure here previously left no durable trail.
    console.error("[reviews] moderateRatingAction failed", error);
    return {
      error: "Der Moderationsstatus konnte nicht geändert werden. Bitte versuchen Sie es erneut.",
    };
  }
}
