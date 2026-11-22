import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/auth/account-context";
import { PermissionDeniedError, requireTenantPermission } from "@/lib/auth/permissions";
import { OnboardingButton } from "./onboarding-button";

interface PaymentAccountRow {
  status: "pending" | "restricted" | "enabled";
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements_summary: string | null;
}

const STATUS_LABEL: Record<PaymentAccountRow["status"], string> = {
  pending: "Onboarding läuft",
  restricted: "Eingeschränkt -- weitere Angaben nötig",
  enabled: "Aktiv",
};

/**
 * Ticket #23: Stripe Connect onboarding status + entry point. Gated on
 * `payments.read` server-side -- a member without the permission sees a
 * plain access-denied message instead of the connection status/button.
 * TEST MODE ONLY: the underlying Stripe calls (`lib/stripe/client.ts`)
 * hard-refuse a non-test-mode secret key.
 */
export default async function PaymentsPage() {
  const { supabase, user, membership } = await getAccountContext();

  if (!user) {
    redirect("/login");
  }

  if (!membership) {
    redirect("/account");
  }

  try {
    await requireTenantPermission(supabase, membership.tenantId, "payments.read");
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-surface-secondary p-8">
          <p role="alert" className="text-foreground">
            Sie haben nicht die erforderliche Berechtigung, um den Zahlungsstatus einzusehen.
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

  // The account read and the (UX-only) `payments.connect` check are independent.
  const canConnectPromise = (async () => {
    // payments.connect (issue #95) is a separate, Owner-only permission from
    // the payments.read that gates this whole page -- a Manager can view
    // status but must not see a button that would just fail server-side.
    try {
      await requireTenantPermission(supabase, membership.tenantId, "payments.connect");
      return true;
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        return false;
      }
      throw error;
    }
  })();

  const [{ data: account }, canConnect] = await Promise.all([
    supabase
      .from("payment_accounts")
      .select("status, charges_enabled, payouts_enabled, requirements_summary")
      .eq("tenant_id", membership.tenantId)
      .maybeSingle<PaymentAccountRow>(),
    canConnectPromise,
  ]);

  return (
    <main className="min-h-screen bg-surface-secondary">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-semibold text-foreground">Zahlungen</h1>
          <Link
            href="/account"
            className="text-sm font-medium text-link-foreground underline hover:text-brand-700"
          >
            Zurück
          </Link>
        </div>

        <p className="text-sm text-foreground">
          Test-Modus: Es werden ausschließlich Stripe-Testzahlungen verarbeitet, bis eine
          Produktivfreigabe ausdrücklich erteilt wurde.
        </p>

        <section
          aria-labelledby="payments-status-heading"
          className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface p-6"
        >
          <h2 id="payments-status-heading" className="text-lg font-medium text-foreground">
            Stripe-Verbindungsstatus
          </h2>

          <p className="text-sm text-foreground">
            <span className="font-medium">Status: </span>
            {account ? STATUS_LABEL[account.status] : "Nicht verbunden"}
          </p>

          {account ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-foreground">
              <dt>Zahlungen möglich (charges_enabled)</dt>
              <dd>{account.charges_enabled ? "Ja" : "Nein"}</dd>
              <dt>Auszahlungen möglich (payouts_enabled)</dt>
              <dd>{account.payouts_enabled ? "Ja" : "Nein"}</dd>
              {account.requirements_summary ? (
                <>
                  <dt>Offene Anforderungen</dt>
                  <dd>{account.requirements_summary}</dd>
                </>
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-foreground">Es wurde noch kein Stripe-Konto verbunden.</p>
          )}

          {canConnect ? (
            <OnboardingButton
              label={
                !account
                  ? "Verbindung mit Stripe starten"
                  : account.status === "enabled"
                    ? "Stripe-Onboarding erneut aufrufen"
                    : "Onboarding fortsetzen"
              }
            />
          ) : (
            <p className="text-sm text-foreground">
              Nur der Inhaber (Owner) kann das Stripe-Konto verbinden oder das Onboarding
              fortsetzen.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
