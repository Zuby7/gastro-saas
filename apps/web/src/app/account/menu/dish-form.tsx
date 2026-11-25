"use client";

import {
  FieldError,
  FormFeedback,
  fieldErrorProps,
  useDismissOnEdit,
} from "@/lib/forms/field-feedback";
import { usePreservedFormAction } from "@/lib/forms/use-preserved-form-action";

import { createDishAction, type MenuActionState } from "./actions";

const initialState: MenuActionState = {};

export function DishForm({ categoryId }: { categoryId: string }) {
  const [state, formAction, isPending] = usePreservedFormAction(createDishAction, initialState);

  const { dismissed, onEdit } = useDismissOnEdit(state);

  return (
    <form {...formAction} onInput={onEdit} className="flex flex-wrap items-end gap-2" noValidate>
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
          {...fieldErrorProps(state, "name", `new-dish-name-error-${categoryId}`)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
        />
        <FieldError id={`new-dish-name-error-${categoryId}`} state={state} name="name" />
      </div>
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`new-dish-price-${categoryId}`}
          className="text-sm font-medium text-foreground"
        >
          Preis (€)
        </label>
        <input
          id={`new-dish-price-${categoryId}`}
          name="priceEuro"
          type="text"
          inputMode="decimal"
          placeholder="z. B. 12,50"
          {...fieldErrorProps(state, "priceEuro", `new-dish-price-error-${categoryId}`)}
          className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-foreground"
        />
        <FieldError id={`new-dish-price-error-${categoryId}`} state={state} name="priceEuro" />
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
          {...fieldErrorProps(state, "description", `new-dish-description-error-${categoryId}`)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
        />
        <FieldError
          id={`new-dish-description-error-${categoryId}`}
          state={state}
          name="description"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
      >
        {isPending ? "Wird angelegt…" : "Gericht anlegen"}
      </button>
      <FormFeedback state={state} dismissed={dismissed} />
    </form>
  );
}
