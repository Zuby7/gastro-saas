"use client";

import { usePreservedFormAction } from "@/lib/forms/use-preserved-form-action";
import {
  disconnectMollieAction,
  refreshMolliePaypalStatusAction,
  type MollieActionFormState,
} from "./mollie-actions";

const initialState: MollieActionFormState = {};

function ActionMessage({ state }: { state: MollieActionFormState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        aria-live="assertive"
        className="rounded-md border border-danger-500 bg-danger-500/10 p-3 text-sm text-danger-foreground"
      >
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="rounded-md border border-neutral-300 p-3 text-sm text-foreground">
        {state.message}
      </p>
    );
  }
  return null;
}

interface MollieCardProps {
  connected: boolean;
  needsReauth: boolean;
  paypalEnabled: boolean;
  canConnect: boolean;
  flashMessage: string | null;
}

/**
 * Issue #195: PayPal via Mollie card. Buttons are only a convenience -- the
 * connect route and both actions re-check `payments.connect` server-side.
 */
export function MollieCard({
  connected,
  needsReauth,
  paypalEnabled,
  canConnect,
  flashMessage,
}: MollieCardProps) {
  const [disconnectState, disconnectProps, disconnectPending] = usePreservedFormAction(
    disconnectMollieAction,
    initialState,
  );
  const [refreshState, refreshProps, refreshPending] = usePreservedFormAction(
    refreshMolliePaypalStatusAction,
    initialState,
  );

  const statusText = !connected
    ? "Nicht verbunden"
    : needsReauth
      ? "Verbindung abgelaufen -- bitte neu verbinden"
      : paypalEnabled
        ? "Verbunden, PayPal aktiv"
        : "Verbunden, PayPal noch nicht aktiviert";

  return (
    <section
      aria-labelledby="mollie-heading"
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-surface p-6"
    >
      <h2 id="mollie-heading" className="text-lg font-medium text-foreground">
        PayPal über Mollie verbinden
      </h2>

      <p className="text-sm text-foreground">
        Für PayPal-Zahlungen benötigt Ihr Restaurant ein eigenes Mollie-Konto. Dort müssen Sie
        PayPal unter Einstellungen &gt; Zahlungsmethoden &gt; PayPal mit &quot;Mit PayPal
        verbinden&quot; aktivieren; dafür ist ein PayPal-Geschäftskonto nötig. Das Geld geht direkt
        an Ihr Konto, Sie sind selbst Vertragspartner und für Erstattungen zuständig. Aktuell nur im
        Testmodus.
      </p>

      {flashMessage ? (
        <p
          role="status"
          className="rounded-md border border-neutral-300 p-3 text-sm text-foreground"
        >
          {flashMessage}
        </p>
      ) : null}

      <p className="text-sm text-foreground">
        <span className="font-medium">Status: </span>
        {statusText}
      </p>

      {canConnect ? (
        <div className="flex flex-wrap items-start gap-3">
          <a
            href="/account/payments/mollie/connect"
            className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
          >
            {connected ? "Mollie erneut verbinden" : "PayPal über Mollie verbinden"}
          </a>

          {connected ? (
            <>
              <form {...refreshProps} className="flex flex-col gap-2">
                <button
                  type="submit"
                  disabled={refreshPending}
                  className="rounded-md border border-neutral-300 px-4 py-2 font-medium text-foreground disabled:opacity-60"
                >
                  {refreshPending ? "Wird geprüft…" : "PayPal-Status prüfen"}
                </button>
              </form>
              <form {...disconnectProps} className="flex flex-col gap-2">
                <button
                  type="submit"
                  disabled={disconnectPending}
                  className="rounded-md border border-danger-500 px-4 py-2 font-medium text-danger-foreground disabled:opacity-60"
                >
                  {disconnectPending ? "Wird getrennt…" : "Trennen"}
                </button>
              </form>
            </>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-foreground">
          Nur der Inhaber (Owner) kann die PayPal-Verbindung herstellen oder trennen.
        </p>
      )}

      <ActionMessage state={refreshState} />
      <ActionMessage state={disconnectState} />
    </section>
  );
}
