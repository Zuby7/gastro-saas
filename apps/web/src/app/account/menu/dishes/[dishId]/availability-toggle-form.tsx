"use client";

import { useActionState } from "react";
import type { DishActionState } from "./actions";

const initialState: DishActionState = {};

export type AvailabilityAction = (
  prevState: DishActionState,
  formData: FormData,
) => Promise<DishActionState>;

export interface AvailabilityToggleFormProps {
  action: AvailabilityAction;
  /** Hidden form fields identifying the target row (dishId, plus variantId/optionId if applicable). */
  hiddenFields: Record<string, string>;
  isAvailable: boolean;
  availableAgainAt: string | null;
  /** Used in the datetime input's id/label so multiple toggles on one page don't collide. */
  idPrefix: string;
  /** Short label for the accessible status text, e.g. the dish/variant/option name. */
  itemLabel: string;
}

/**
 * Ticket #29: shared sold-out toggle control for dishes/variants/options.
 * Accessibility requirement ("not just color-coded"): status is announced
 * via visible text ("Ausverkauft" / "Verfügbar") plus an icon-free badge
 * with sufficient contrast, not a bare color change -- mirrors the public
 * menu's existing "Ausverkauft" text badge (`dish-card.tsx`).
 */
export function AvailabilityToggleForm({
  action,
  hiddenFields,
  isAvailable,
  availableAgainAt,
  idPrefix,
  itemLabel,
}: AvailabilityToggleFormProps) {
  const [state, formAction, isPending] = useActionState(action, initialState);
  const dateTimeInputId = `${idPrefix}-available-again-at`;

  // datetime-local inputs need "YYYY-MM-DDTHH:mm" with no timezone/seconds.
  const defaultDateTimeValue = availableAgainAt ? availableAgainAt.slice(0, 16) : "";

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-2 rounded-md bg-neutral-50 p-2"
    >
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="isAvailable" value={(!isAvailable).toString()} />

      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${
          isAvailable ? "border-success-500 text-success-700" : "border-danger-500 text-danger-600"
        }`}
      >
        {isAvailable ? "Verfügbar" : "Ausverkauft"}
      </span>

      <div className="flex flex-col gap-1">
        <label htmlFor={dateTimeInputId} className="text-xs font-medium text-foreground-secondary">
          Automatisch wieder verfügbar ab (optional)
        </label>
        <input
          id={dateTimeInputId}
          name="availableAgainAt"
          type="datetime-local"
          defaultValue={defaultDateTimeValue}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-foreground"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        aria-label={
          isAvailable
            ? `${itemLabel} als ausverkauft markieren`
            : `${itemLabel} als verfügbar markieren`
        }
        className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${
          isAvailable ? "border-danger-500 text-danger-600" : "border-success-500 text-success-700"
        }`}
      >
        {isPending
          ? "Wird gespeichert…"
          : isAvailable
            ? "Als ausverkauft markieren"
            : "Als verfügbar markieren"}
      </button>

      {state.error ? (
        <p role="alert" className="w-full text-sm text-danger-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
