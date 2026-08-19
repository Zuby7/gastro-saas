"use client";

import { useActionState } from "react";
import { submitRatingAction, type RatingFormState } from "./rating-actions";

interface RatingFormProps {
  tenantSlug: string;
  token: string;
}

const initialState: RatingFormState = {};

const STAR_OPTIONS = [1, 2, 3, 4, 5] as const;

/**
 * Rating form shown on the order-status page once the order is `completed`
 * (ticket #33's UI state). Plain labelled radio buttons rather than a
 * clickable-icon star widget -- keeps the rating keyboard-operable and
 * screen-reader-friendly without any color-only signaling
 * (`.claude/rules/frontend.md`), while still reading naturally as "star
 * rating" via each option's visible/aria label.
 *
 * `tenantSlug`/`token` are bound server-side arguments (never client-editable
 * form fields), mirroring `CheckoutForm`'s binding pattern.
 */
export function RatingForm({ tenantSlug, token }: RatingFormProps) {
  const [state, formAction, isPending] = useActionState(
    submitRatingAction.bind(null, tenantSlug, token),
    initialState,
  );

  if (state.success) {
    return (
      <section
        aria-live="polite"
        className="rounded-lg border border-neutral-200 bg-neutral-0 p-5 shadow-sm"
      >
        <h2 className="text-sm font-semibold text-foreground">Vielen Dank für Ihre Bewertung!</h2>
        <p className="mt-1 text-sm text-foreground-secondary">
          Ihre Bewertung wurde erfolgreich übermittelt.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-neutral-0 p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">Wie war Ihre Bestellung?</h2>
      <form action={formAction} className="mt-3 flex flex-col gap-4" noValidate>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">Bewertung</legend>
          <div className="flex flex-wrap gap-3">
            {STAR_OPTIONS.map((value) => (
              <label key={value} className="flex items-center gap-1.5 text-sm text-foreground">
                <input
                  type="radio"
                  name="stars"
                  value={value}
                  required
                  className="h-4 w-4 accent-brand-600"
                />
                {value} {value === 1 ? "Stern" : "Sterne"}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor="comment" className="text-sm font-medium text-foreground">
            Kommentar (optional)
          </label>
          <textarea
            id="comment"
            name="comment"
            maxLength={1000}
            rows={3}
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-600"
          />
        </div>

        {state.error ? (
          <p
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-danger-500 bg-danger-500/10 p-3 text-sm font-medium text-danger-600"
          >
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-neutral-0 transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? "Wird gesendet…" : "Bewertung abschicken"}
        </button>
      </form>
    </section>
  );
}
