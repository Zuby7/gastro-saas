"use client";

import { useActionState } from "react";
import { setAllergenReviewedAction, updateDishBasicsAction, type DishActionState } from "./actions";

const initialState: DishActionState = {};

export interface DishBasicsFormProps {
  dishId: string;
  name: string;
  description: string;
  priceCents: number | null;
  allergenReviewed: boolean;
}

export function DishBasicsForm({
  dishId,
  name,
  description,
  priceCents,
  allergenReviewed,
}: DishBasicsFormProps) {
  const [state, formAction, isPending] = useActionState(updateDishBasicsAction, initialState);
  const [reviewState, reviewFormAction, isReviewPending] = useActionState(
    setAllergenReviewedAction,
    initialState,
  );

  return (
    <section className="flex flex-col gap-4 rounded-md border border-neutral-300 p-4">
      <h2 className="text-lg font-semibold text-foreground">Grunddaten</h2>

      {state.error ? (
        <p role="alert" className="text-sm text-danger-600">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-sm text-success-600">
          {state.success}
        </p>
      ) : null}

      <form action={formAction} className="flex flex-col gap-3" noValidate>
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
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
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
            className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="dish-price" className="text-sm font-medium text-foreground">
            Grundpreis (Cent)
          </label>
          <input
            id="dish-price"
            name="priceCents"
            type="text"
            inputMode="numeric"
            defaultValue={priceCents ?? ""}
            placeholder="z. B. 1200"
            className="w-32 rounded-md border border-neutral-300 px-3 py-2 text-foreground"
          />
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
        <p role="alert" className="text-sm text-danger-600">
          {reviewState.error}
        </p>
      ) : null}
    </section>
  );
}
