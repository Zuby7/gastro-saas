"use client";

import { useActionState } from "react";
import { startStripeOnboardingAction, type PaymentsOnboardingFormState } from "./actions";

const initialState: PaymentsOnboardingFormState = {};

export function OnboardingButton({ label }: { label: string }) {
  const [state, formAction, isPending] = useActionState(startStripeOnboardingAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.error ? (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-danger-500 bg-danger-500/10 p-3 text-sm text-danger-foreground"
        >
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {isPending ? "Wird weitergeleitet…" : label}
      </button>
    </form>
  );
}
