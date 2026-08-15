import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { createStripeClient } from "@/lib/stripe/client";
import { createOnboardingAccountLink } from "@/lib/stripe/connect";

/**
 * Ticket #23: Stripe's hosted onboarding `refresh_url` target -- hit when
 * the previously generated Account Link expired before the owner finished.
 * Account Links are single-use and short-lived, so the only correct
 * response is to mint a fresh one and redirect again, never to show an
 * error for an expected expiry.
 */
export default async function PaymentsRefreshPage() {
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
    await requireTenantPermission(supabase, membership.tenantId, "payments.read");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      redirect("/account/payments");
    }
    throw error;
  }

  const { data: existing } = await supabase
    .from("payment_accounts")
    .select("stripe_account_id")
    .eq("tenant_id", membership.tenantId)
    .maybeSingle<{ stripe_account_id: string }>();

  if (!existing) {
    redirect("/account/payments");
  }

  const stripe = createStripeClient();
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const accountLink = await createOnboardingAccountLink(stripe, {
    accountId: existing.stripe_account_id,
    returnUrl: `${origin}/account/payments/return`,
    refreshUrl: `${origin}/account/payments/refresh`,
  });

  redirect(accountLink.url);
}
