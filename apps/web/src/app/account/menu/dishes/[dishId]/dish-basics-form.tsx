"use client";

import {
  FieldError,
  FormFeedback,
  fieldErrorProps,
  useDismissOnEdit,
} from "@/lib/forms/field-feedback";
import { usePreservedFormAction } from "@/lib/forms/use-preserved-form-action";
import { formatCentsAsEuro } from "@/lib/money/euro";
import { useActionState } from "react";
import {
  setAllergenReviewedAction,
  setDishAvailabilityAction,
  updateDishBasicsAction,
  type DishActionState,
} from "./actions";
import { AvailabilityToggleForm } from "./availability-toggle-form";

const initialState: DishActionState = {};

export interface DishBasicsFormProps {
  dishId: string;
  name: string;
  description: string;
  priceCents: number | null;
  allergenReviewed: boolean;
  isAvailable: boolean;
  availableAgainAt: string | null;
  canEditMenu: boolean;
  canManageAvailability: boolean;
}

export function DishBasicsForm({
  dishId,
  name,
  description,
  priceCents,
  allergenReviewed,
  isAvailable,
  availableAgainAt,
  canEditMenu,
  canManageAvailability,
}: DishBasicsFormProps) {
  const [state, formAction, isPending] = usePreservedFormAction(
    updateDishBasicsAction,
    initialState,
    { resetOnSuccess: false },
  );
  const { dismissed, onEdit } = useDismissOnEdit(state);
  const [reviewState, reviewFormAction, isReviewPending] = useActionState(
    setAllergenReviewedAction,
    initialState,
  );

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-surface p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">Grunddaten</h2>

      {canManageAvailability ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-foreground">Verfügbarkeit</h3>
          <AvailabilityToggleForm
            action={setDishAvailabilityAction}
            hiddenFields={{ dishId }}
            isAvailable={isAvailable}
            availableAgainAt={availableAgainAt}
            idPrefix={`dish-${dishId}`}
            itemLabel={name}
          />
        </div>
      ) : null}

      {canEditMenu ? (
        <>
          <FormFeedback state={state} dismissed={dismissed} />

          <form {...formAction} onInput={onEdit} className="flex flex-col gap-3" noValidate>
            <input type="hidden" name="dishId" value={dishId} />
            <div className="flex flex-col gap-1">
              <label htmlFor="dish-name" className="text-sm font-medium text-foreground">
                Name
              </label>
              <input
                id="dish-name"
                name="name"
                defaultValue={name}
                required
                {...fieldErrorProps(state, "name", "dish-name-error")}
                className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
              />
              <FieldError id="dish-name-error" state={state} name="name" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="dish-description" className="text-sm font-medium text-foreground">
                Beschreibung
              </label>
              <textarea
                id="dish-description"
                name="description"
                defaultValue={description}
                rows={3}
                {...fieldErrorProps(state, "description", "dish-description-error")}
                className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
              />
              <FieldError id="dish-description-error" state={state} name="description" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="dish-price" className="text-sm font-medium text-foreground">
                Grundpreis (€)
              </label>
              <input
                id="dish-price"
                name="priceEuro"
                type="text"
                inputMode="decimal"
                defaultValue={priceCents !== null ? formatCentsAsEuro(priceCents) : ""}
                placeholder="z. B. 12,50"
                {...fieldErrorProps(state, "priceEuro", "dish-price-error")}
                className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-foreground"
              />
              <FieldError id="dish-price-error" state={state} name="priceEuro" />
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="self-start rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
            >
              {isPending ? "Wird gespeichert…" : "Speichern"}
            </button>
          </form>

          <form action={reviewFormAction} className="flex items-center gap-2">
            <input type="hidden" name="dishId" value={dishId} />
            <input type="hidden" name="reviewed" value={(!allergenReviewed).toString()} />
            <button
              type="submit"
              disabled={isReviewPending}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-60"
            >
              {allergenReviewed ? "Allergen-Prüfung zurücksetzen" : "Als allergengeprüft markieren"}
            </button>
            <span className="text-sm text-foreground-secondary">
              Nur vom Restaurant angegeben -- keine automatische Rechtsprüfung.
            </span>
          </form>
          {reviewState.error ? (
            <p role="alert" className="text-sm text-danger-foreground">
              {reviewState.error}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
