import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { getCurrentMembership } from "@/lib/tenant/current-membership";
import { recordMenuAdminAuditEvent } from "@/lib/audit/record-menu-admin-audit-event";
import { createStripeClient } from "@/lib/stripe/client";
import { retrieveAccount, summarizeAccount } from "@/lib/stripe/connect";

/**
 * Ticket #23: Stripe's hosted onboarding `return_url` target. Stripe
 * redirects here once the owner finishes (or abandons) the hosted flow, but
 * does not guarantee the account is fully verified by that point -- so this
 * page synchronously re-fetches the account from Stripe (Retrieve Account)
 * and updates `payment_accounts` before showing the live status. The
 * `account.updated` webhook (`/api/webhooks/stripe-connect`) keeps status
 * in sync in the background afterwards even if the owner never returns.
 */
export default async function PaymentsReturnPage() {
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
    .select("stripe_account_id, status")
    .eq("tenant_id", membership.tenantId)
    .maybeSingle<{ stripe_account_id: string; status: string }>();

  if (existing) {
    const stripe = createStripeClient();
    const account = await retrieveAccount(stripe, existing.stripe_account_id);
    const snapshot = summarizeAccount(account);

    // Written through the service-role admin client, never the caller's own
    // session client: `payment_accounts` intentionally grants `authenticated`
    // no UPDATE at all (see the migration) -- these status columns must only
    // ever reflect what Stripe itself just reported, not a value the tenant
    // member's own session could set directly. Tenant scope (`membership.tenantId`)
    // was already resolved server-side above from the caller's own session,
    // never from client input.
    const admin = createSupabaseAdminClient();
    await admin
      .from("payment_accounts")
      .update({
        status: snapshot.status,
        charges_enabled: snapshot.chargesEnabled,
        payouts_enabled: snapshot.payoutsEnabled,
        requirements_summary: snapshot.requirementsSummary,
        onboarding_completed_at: snapshot.status === "enabled" ? new Date().toISOString() : null,
      })
      .eq("tenant_id", membership.tenantId);

    if (snapshot.status !== existing.status) {
      await recordMenuAdminAuditEvent(supabase, {
        tenantId: membership.tenantId,
        actorUserId: user.id,
        action: "payment_account.status_changed",
        targetType: "payment_account",
        targetId: membership.tenantId,
        metadata: { from: existing.status, to: snapshot.status },
      });
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-neutral-50 p-8">
      <h1 className="font-display text-2xl font-semibold text-foreground">
        Stripe-Onboarding abgeschlossen
      </h1>
      <p className="text-sm text-foreground">Der aktuelle Verbindungsstatus wurde aktualisiert.</p>
      <Link
        href="/account/payments"
        className="font-medium text-brand-600 underline hover:text-brand-700"
      >
        Zum Zahlungsstatus
      </Link>
    </main>
  );
}
