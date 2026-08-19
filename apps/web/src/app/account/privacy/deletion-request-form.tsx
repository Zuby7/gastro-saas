"use client";

import { useActionState, useState } from "react";
import { requestTenantDataDeletionAction, type DeletionRequestFormState } from "./actions";

const initialState: DeletionRequestFormState = {};

export function DeletionRequestForm() {
  const [state, formAction, isPending] = useActionState(
    requestTenantDataDeletionAction,
    initialState,
  );
  const [confirmed, setConfirmed] = useState(false);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-danger-500/40 bg-danger-500/5 p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">Loeschantrag stellen</h2>
      <p className="text-sm text-foreground">
        Bestell- und Zahlungsdaten innerhalb der gesetzlich dokumentierten Aufbewahrungsfrist (10
        Jahre) werden dabei niemals geloescht -- nur Kundendaten aelterer Bestellungen werden
        anonymisiert. Analytics-Events werden vollstaendig geloescht. Diese Aktion steht nur dem
        Owner zur Verfuegung.
      </p>

      {state.error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-danger-500 bg-danger-500/10 p-3 text-sm text-danger-600"
        >
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-neutral-300 bg-neutral-100 p-3 text-sm text-foreground"
        >
          {state.success}
        </p>
      ) : null}

      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="reason" className="text-sm font-medium text-foreground">
            Begruendung (optional)
          </label>
          <textarea
            id="reason"
            name="reason"
            maxLength={500}
            rows={3}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="h-4 w-4"
          />
          Ich bestaetige, dass ich diesen Loeschantrag stellen moechte.
        </label>

        <button
          type="submit"
          disabled={isPending || !confirmed}
          className="w-fit rounded-md bg-danger-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
        >
          {isPending ? "Wird verarbeitet..." : "Loeschantrag stellen"}
        </button>
      </form>
    </section>
  );
}
