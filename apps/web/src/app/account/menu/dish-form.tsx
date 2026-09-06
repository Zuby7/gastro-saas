"use client";

import { useActionState } from "react";
import { createDishAction, type MenuActionState } from "./actions";

const initialState: MenuActionState = {};

export function DishForm({ categoryId }: { categoryId: string }) {
  const [state, formAction, isPending] = useActionState(createDishAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2" noValidate>
      <input type="hidden" name="categoryId" value={categoryId} />
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`new-dish-name-${categoryId}`}
          className="text-sm font-medium text-foreground"
        >
          Name
        </label>
        <input
          id={`new-dish-name-${categoryId}`}
          name="name"
          type="text"
          required
          aria-invalid={state.fieldErrors?.name ? true : undefined}
          className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`new-dish-price-${categoryId}`}
          className="text-sm font-medium text-foreground"
        >
          Preis (Cent)
        </label>
        <input
          id={`new-dish-price-${categoryId}`}
          name="priceCents"
          type="text"
          inputMode="numeric"
          placeholder="z. B. 1200"
          aria-invalid={state.fieldErrors?.priceCents ? true : undefined}
          className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-foreground"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`new-dish-description-${categoryId}`}
          className="text-sm font-medium text-foreground"
        >
          Beschreibung
        </label>
        <input
          id={`new-dish-description-${categoryId}`}
          name="description"
          type="text"
          className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
      >
        {isPending ? "Wird angelegt…" : "Gericht anlegen"}
      </button>
      {state.error ? (
        <p role="alert" className="w-full text-sm text-danger-foreground">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
