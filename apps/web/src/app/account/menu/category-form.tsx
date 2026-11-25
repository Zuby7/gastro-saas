"use client";

import {
  FieldError,
  FormFeedback,
  fieldErrorProps,
  useDismissOnEdit,
} from "@/lib/forms/field-feedback";
import { usePreservedFormAction } from "@/lib/forms/use-preserved-form-action";

import { createCategoryAction, type MenuActionState } from "./actions";

const initialState: MenuActionState = {};

export function CategoryForm() {
  const [state, formAction, isPending] = usePreservedFormAction(createCategoryAction, initialState);

  const { dismissed, onEdit } = useDismissOnEdit(state);

  return (
    <form {...formAction} onInput={onEdit} className="flex flex-wrap items-end gap-2" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="new-category-name" className="text-sm font-medium text-foreground">
          Neue Kategorie
        </label>
        <input
          id="new-category-name"
          name="name"
          type="text"
          required
          {...fieldErrorProps(state, "name", "new-category-name-error")}
          className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
        />
        <FieldError id="new-category-name-error" state={state} name="name" />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
      >
        {isPending ? "Wird angelegt…" : "Anlegen"}
      </button>
      <FormFeedback state={state} dismissed={dismissed} />
    </form>
  );
}
