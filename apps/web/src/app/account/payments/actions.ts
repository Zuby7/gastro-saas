"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";
import { createStripeClient } from "@/lib/stripe/client";
import { createExpressAccount, createOnboardingAccountLink } from "@/lib/stripe/connect";

export interface PaymentsOnboardingFormState {
  error?: string;
}

/**
 * Ticket #23: creates the tenant's Stripe Express connected account (if it
 * doesn't exist yet) and redirects to a freshly generated, Stripe-hosted
 * Account Link. Never handles verification documents itself -- Stripe's
 * hosted onboarding does that. Gated server-side on `payments.read` (RLS
 * enforces it again independently on the `payment_accounts` writes below).
 */
export async function startStripeOnboardingAction(
  _prevState: PaymentsOnboardingFormState,
  _formData: FormData,
): Promise<PaymentsOnboardingFormState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const membership = await getCurrentMembership(supabase, user.id);
  if (!membership) {
    return { error: "Sie sind noch keinem Restaurant zugeordnet." };
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "payments.read");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return {
        error: "Sie haben nicht die erforderliche Berechtigung, das Stripe-Konto zu verbinden.",
      };
    }
    throw error;
  }

  const { data: existing } = await supabase
    .from("payment_accounts")
    .select("stripe_account_id")
    .eq("tenant_id", membership.tenantId)
    .maybeSingle<{ stripe_account_id: string }>();

  const stripe = createStripeClient();
  let accountId = existing?.stripe_account_id ?? null;

  if (!accountId) {
    const account = await createExpressAccount(stripe, {
      tenantId: membership.tenantId,
      email: user.email,
    });
    accountId = account.id;

    // Written through the service-role admin client, never the caller's own
    // session client: `payment_accounts` intentionally grants `authenticated`
    // no INSERT at all (see the migration) -- `stripe_account_id` must only
    // ever be a value this server itself just received from Stripe for this
    // exact tenant, never a value the client could choose (epic-7 batch
    // review fix -- previously a Manager could insert a row pointing at an
    // account they controlled and redirect the tenant's payouts).
    const admin = createSupabaseAdminClient();
    const { error: insertError } = await admin.from("payment_accounts").insert({
      tenant_id: membership.tenantId,
      stripe_account_id: accountId,
      created_by_user_id: user.id,
    });

    if (insertError) {
      return {
        error: "Das Stripe-Konto konnte nicht angelegt werden. Bitte versuchen Sie es erneut.",
      };
    }

    await recordMenuAdminAuditEvent(supabase, {
      tenantId: membership.tenantId,
      actorUserId: user.id,
      action: "payment_account.connect_started",
      targetType: "payment_account",
      targetId: membership.tenantId,
    });
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const accountLink = await createOnboardingAccountLink(stripe, {
    accountId,
    returnUrl: `${origin}/account/payments/return`,
    refreshUrl: `${origin}/account/payments/refresh`,
  });

  redirect(accountLink.url);
}
