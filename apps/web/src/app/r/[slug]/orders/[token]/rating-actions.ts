"use server";

import { revalidatePath } from "next/cache";
import { getClientIp } from "@/lib/auth/client-ip";
import { reserveAndCheckRateLimit } from "@/lib/auth/rate-limit";
import { createSupabaseRateLimitStore } from "@/lib/auth/supabase-rate-limit-store";
import { RatingDomainError, submitOrderRating } from "@/lib/ratings/service";
import { RatingSchema } from "@/lib/ratings/schemas";
import { hashOrderAccessToken } from "@/lib/orders/token";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface RatingFormState {
  error?: string;
  success?: boolean;
}

/**
 * `tenantSlug` and `rawToken` are always the first two (bound) arguments,
 * mirroring `checkoutAction`'s binding pattern in
 * `apps/web/src/app/r/[slug]/checkout/actions.ts` -- never read from
 * client-editable form data. `rawToken` is the exact same guest order-access
 * token already embedded in this route's `[token]` segment (see this
 * file's sibling `page.tsx`) -- no separate "rating token" is minted (see
 * the ratings migration's header comment for why reusing it here doesn't
 * create a second authorization surface).
 */
export async function submitRatingAction(
  tenantSlug: string,
  rawToken: string,
  _prevState: RatingFormState,
  formData: FormData,
): Promise<RatingFormState> {
  const parsed = RatingSchema.safeParse({
    stars: formData.get("stars"),
    comment: formData.get("comment") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Bitte prüfen Sie Ihre Eingaben." };
  }

  const guestAccessTokenHash = hashOrderAccessToken(rawToken);

  try {
    // Rate-limit rating submission per `.claude/rules/backend-api.md`
    // ("rate-limit ... endpoints") and this ticket's explicit "Missbrauchsschutz
    // (Rate-Limiting)" requirement -- reusing the exact same atomic
    // reserve-and-count mechanism as login/register/checkout/invite rather
    // than inventing a second one (see `apps/web/src/lib/auth/rate-limit.ts`).
    // Guest rating has no email identity, so the (ip, *) bucket is keyed on
    // the guest access token hash instead -- mirroring checkout's
    // (ip, cart id) precedent: still meaningful (one guest identity per
    // order) while the ip-only bucket independently caps any single source
    // regardless of how many order tokens it cycles/guesses through.
    const admin = createSupabaseAdminClient();
    const rateLimitStore = createSupabaseRateLimitStore(admin);
    const ip = await getClientIp();
    const { limited } = await reserveAndCheckRateLimit(rateLimitStore, {
      scope: "rating",
      ip,
      email: guestAccessTokenHash,
      // A genuine guest submits at most once per order (the DB enforces
      // "only once" regardless) -- a handful of attempts covers accidental
      // double-submits/retries without opening a meaningful abuse window.
      maxAttempts: 5,
      // Deliberately widened beyond maxAttempts (like login/invite, unlike
      // checkout's equal-threshold choice) -- guests rating orders from the
      // same restaurant's shared WiFi/CGNAT can plausibly share one IP, and
      // unlike checkout there is no "every attempt must count, including
      // successes" concern here forcing a tight IP-only cap (see
      // `apps/web/src/lib/auth/rate-limit.ts`'s header comment on
      // `maxIpAttempts`).
      maxIpAttempts: 20,
      windowSeconds: 60 * 60,
    });

    if (limited) {
      return {
        error: "Zu viele Versuche. Bitte versuchen Sie es später erneut.",
      };
    }

    await submitOrderRating({
      guestAccessTokenHash,
      stars: parsed.data.stars,
      comment: parsed.data.comment,
    });

    revalidatePath(`/r/${tenantSlug}/orders/${rawToken}`);

    return { success: true };
  } catch (error) {
    if (error instanceof RatingDomainError) {
      return { error: error.message };
    }
    console.error("[ratings] submitRatingAction failed", error);
    return {
      error: "Die Bewertung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
    };
  }
}
