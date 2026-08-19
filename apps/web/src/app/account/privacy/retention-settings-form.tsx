"use client";

import { useActionState } from "react";
import { saveRetentionSettingsAction, type RetentionSettingsFormState } from "./actions";

const initialState: RetentionSettingsFormState = {};

export function RetentionSettingsForm({ initialRetentionDays }: { initialRetentionDays: number }) {
  const [state, formAction, isPending] = useActionState(saveRetentionSettingsAction, initialState);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-0 p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">Aufbewahrungsfrist Analytics-Events</h2>
      <p className="text-sm text-foreground">
        Legt fest, nach wie vielen Tagen Analytics-Events automatisch bereinigt werden. Audit-Logs
        sind aus Sicherheitsgruenden unveraenderlich und hier nicht konfigurierbar.
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
          <label
            htmlFor="analyticsEventsRetentionDays"
            className="text-sm font-medium text-foreground"
          >
            Aufbewahrungsfrist (Tage)
          </label>
          <input
            id="analyticsEventsRetentionDays"
            name="analyticsEventsRetentionDays"
            type="number"
            min={30}
            max={3650}
            required
            defaultValue={initialRetentionDays}
            aria-invalid={state.fieldErrors?.analyticsEventsRetentionDays ? true : undefined}
            aria-describedby={
              state.fieldErrors?.analyticsEventsRetentionDays
                ? "analyticsEventsRetentionDays-error"
                : undefined
            }
            className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
          {state.fieldErrors?.analyticsEventsRetentionDays ? (
            <span id="analyticsEventsRetentionDays-error" className="text-sm text-danger-600">
              {state.fieldErrors.analyticsEventsRetentionDays}
            </span>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-fit rounded-md bg-brand-700 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
        >
          {isPending ? "Speichert..." : "Speichern"}
        </button>
      </form>
    </section>
  );
}
