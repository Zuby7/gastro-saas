"use client";

import { useActionState } from "react";
import { saveOpeningHoursAction, type OpeningHoursFormState } from "./actions";

export interface OpeningHourInitialValue {
  weekday: number;
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
}

const WEEKDAY_LABELS = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

const initialState: OpeningHoursFormState = {};

export function OpeningHoursForm({ initial }: { initial: OpeningHourInitialValue[] }) {
  const [state, formAction, isPending] = useActionState(saveOpeningHoursAction, initialState);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-0 p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">Öffnungszeiten</h2>

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

      <form action={formAction} className="flex flex-col gap-3" noValidate>
        {initial.map((row) => (
          <fieldset
            key={row.weekday}
            className="grid grid-cols-1 items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3 sm:grid-cols-4"
          >
            <legend className="sr-only">{WEEKDAY_LABELS[row.weekday]}</legend>
            <span className="font-medium text-foreground">{WEEKDAY_LABELS[row.weekday]}</span>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name={`closed-${row.weekday}`} defaultChecked={row.isClosed} />
              Geschlossen
            </label>

            <div className="flex flex-col gap-1">
              <label htmlFor={`opens-${row.weekday}`} className="text-sm text-foreground">
                Öffnet
              </label>
              <input
                id={`opens-${row.weekday}`}
                name={`opens-${row.weekday}`}
                type="time"
                defaultValue={row.opensAt}
                aria-invalid={state.fieldErrors?.[`opensAt-${row.weekday}`] ? true : undefined}
                className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor={`closes-${row.weekday}`} className="text-sm text-foreground">
                Schließt
              </label>
              <input
                id={`closes-${row.weekday}`}
                name={`closes-${row.weekday}`}
                type="time"
                defaultValue={row.closesAt}
                aria-invalid={state.fieldErrors?.[`closesAt-${row.weekday}`] ? true : undefined}
                className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
              />
            </div>

            {state.fieldErrors?.[`opensAt-${row.weekday}`] ? (
              <span className="text-sm text-danger-600 sm:col-span-4">
                {state.fieldErrors[`opensAt-${row.weekday}`]}
              </span>
            ) : null}
            {state.fieldErrors?.[`closesAt-${row.weekday}`] ? (
              <span className="text-sm text-danger-600 sm:col-span-4">
                {state.fieldErrors[`closesAt-${row.weekday}`]}
              </span>
            ) : null}
          </fieldset>
        ))}

        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
        >
          {isPending ? "Wird gespeichert…" : "Öffnungszeiten speichern"}
        </button>
      </form>
    </section>
  );
}
