import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { listTenantRatingsForModeration } from "@/lib/ratings/moderation-service";
import { ReviewModerationList } from "./review-moderation-list";

/**
 * Admin moderation queue for guest ratings (Epic 10, ticket #34). Gated on
 * `reviews.read` (both here, server-side, and independently by the
 * `ratings_select_reviews_read`/`rating_moderation_select_reviews_read` RLS
 * policies plus `list_tenant_ratings_for_moderation()`'s own re-check -- see
 * the ticket's migration). Mirrors the staff order dashboard's page
 * structure (`apps/web/src/app/account/orders/page.tsx`, ticket #27).
 */
export default async function ReviewModerationPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    redirect("/account");
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "reviews.read");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-surface-secondary p-8">
          <p role="alert" className="text-foreground">
            Sie haben nicht die erforderliche Berechtigung, um die Bewertungen einzusehen.
          </p>
          <Link
            href="/account"
            className="font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </main>
      );
    }
    throw error;
  }

  const ratings = await listTenantRatingsForModeration(supabase, membership.tenantId);

  // Deliberately does not redirect/block the page if missing (unlike
  // `reviews.read` above): `reviews.moderate` only controls whether the
  // status-change buttons render -- a member with `reviews.read` but not
  // `reviews.moderate` should still be able to view the queue. This is a UX
  // affordance only; `moderateRatingAction` re-checks `reviews.moderate`
  // server-side regardless (see `./actions.ts`), so hiding the buttons here
  // is never the actual authorization boundary.
  let canModerate = false;
  try {
    await requireTenantPermission(supabase, membership.tenantId, "reviews.moderate");
    canModerate = true;
  } catch (error) {
    if (!(error instanceof PermissionDeniedError)) {
      throw error;
    }
  }

  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">
            Bewertungen moderieren
          </h1>
          <Link
            href="/account"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </div>

        <ReviewModerationList initialRatings={ratings} canModerate={canModerate} />
      </div>
    </main>
  );
}
