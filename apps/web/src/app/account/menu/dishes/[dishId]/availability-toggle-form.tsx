"use client";

import { useActionState, useState } from "react";
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
 *
 * Epic 8 Opus batch review, finding 5: the badge and the toggle's target
 * state must be derived from *effective* availability -- what
 * `is_menu_item_available()` would return (`isAvailable` OR
 * `availableAgainAt` has already passed) -- not the raw `isAvailable`
 * column alone. Otherwise an item whose schedule has already lapsed still
 * shows "Ausverkauft" in the admin UI (and toggling it would flip
 * `isAvailable` to `true` a second time) even though it's already
 * purchasable on the public menu.
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

  // `Date.now()` is impure and may not be called directly during render
  // (react-hooks/purity) -- snapshot it once per mount instead. This is a
  // one-shot admin form (a full page load, per the migration's own "no
  // cron/background job" design), so a mount-time snapshot is exactly as
  // fresh as every other value on this page.
  const [nowMs] = useState(() => Date.now());

  // Mirrors is_menu_item_available()'s SQL formula exactly: effectively
  // available if the raw column says so, OR a scheduled re-availability
  // timestamp has already passed.
  const isEffectivelyAvailable =
    isAvailable || (availableAgainAt !== null && new Date(availableAgainAt).getTime() <= nowMs);

  // datetime-local inputs need "YYYY-MM-DDTHH:mm" with no timezone/seconds.
  const defaultDateTimeValue = availableAgainAt ? availableAgainAt.slice(0, 16) : "";

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-2 rounded-md bg-surface-secondary p-2"
    >
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="isAvailable" value={(!isEffectivelyAvailable).toString()} />

      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold ${
          isEffectivelyAvailable
            ? "border-success-500 text-success-700"
            : "border-danger-500 text-danger-foreground"
        }`}
      >
        {isEffectivelyAvailable ? "Verfügbar" : "Ausverkauft"}
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
          isEffectivelyAvailable
            ? `${itemLabel} als ausverkauft markieren`
            : `${itemLabel} als verfügbar markieren`
        }
        className={`inline-flex min-h-12 items-center justify-center rounded-md border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${
          isEffectivelyAvailable
            ? "border-danger-500 text-danger-foreground focus-visible:outline-danger-600"
            : "border-success-500 text-success-700 focus-visible:outline-success-600"
        }`}
      >
        {isPending
          ? "Wird gespeichert…"
          : isEffectivelyAvailable
            ? "Als ausverkauft markieren"
            : "Als verfügbar markieren"}
      </button>

      {state.error ? (
        <p role="alert" className="w-full text-sm text-danger-foreground">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
