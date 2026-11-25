"use client";

import Link from "next/link";
import { usePreservedFormAction } from "@/lib/forms/use-preserved-form-action";
import { retryPaymentAction, type RetryPaymentState } from "./actions";

interface PaymentNoticeProps {
  tenantSlug: string;
  token: string;
  /** The `?checkout=` value Stripe's success/cancel return URL carried. */
  checkout: "cancelled" | "success";
}

const initialState: RetryPaymentState = {};

/**
 * Shown on the order-status page only while the order is still
 * `awaiting_payment`. Neither return URL is proof of payment -- the page's
 * real status still comes from the webhook-driven order status; this only
 * explains the situation and, after a cancel, offers a way forward ("Erneut
 * bezahlen" only re-uses the order's still-open Stripe session, it never
 * creates a second one). No guest cancel path exists in the domain, so no
 * cancel button is offered; an unpaid order is cancelled automatically by
 * the awaiting-payment timeout.
 */
export function PaymentNotice({ tenantSlug, token, checkout }: PaymentNoticeProps) {
  const [state, formAction, isPending] = usePreservedFormAction(
    retryPaymentAction.bind(null, tenantSlug, token),
    initialState,
    { resetOnSuccess: false },
  );

  if (checkout === "success" || state.outcome === "confirming") {
    return (
      <section
        role="status"
        aria-live="polite"
        className="rounded-lg border border-neutral-300 bg-surface p-5 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-foreground">Zahlung wird bestätigt</h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          Vielen Dank! Wir warten noch auf die Bestätigung Ihrer Zahlung. Diese Seite aktualisiert
          sich automatisch.
        </p>
      </section>
    );
  }

  if (state.outcome === "expired") {
    return (
      <section role="alert" className="rounded-lg border border-danger-500 bg-danger-500/10 p-5">
        <h2 className="text-sm font-semibold text-danger-foreground">Zahlungsfrist abgelaufen</h2>
        <p className="mt-1 text-sm text-foreground">
          Die Zahlungsfrist ist abgelaufen. Bitte bestellen Sie erneut.
        </p>
        <Link
          href={`/r/${tenantSlug}`}
          className="mt-3 inline-flex min-h-11 items-center font-medium text-link-foreground underline"
        >
          Zurück zur Speisekarte
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-danger-500 bg-danger-500/10 p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-danger-foreground">Zahlung abgebrochen</h2>
      <p className="mt-1 text-sm text-foreground">
        Ihre Bestellung ist noch nicht bezahlt. Sie können die Zahlung jetzt erneut starten. Wird
        die Bestellung nicht bezahlt, wird sie nach kurzer Zeit automatisch storniert.
      </p>
      <form {...formAction} className="mt-3">
        <button
          type="submit"
          disabled={isPending}
          className="min-h-11 rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
        >
          {isPending ? "Zahlung wird vorbereitet..." : "Erneut bezahlen"}
        </button>
      </form>
      {state.error ? (
        <p role="alert" className="mt-2 text-sm text-danger-foreground">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}
