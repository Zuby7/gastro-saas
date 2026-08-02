"use client";

import { useActionState } from "react";
import { createCategoryAction, type MenuActionState } from "./actions";

const initialState: MenuActionState = {};

export function CategoryForm() {
  const [state, formAction, isPending] = useActionState(createCategoryAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="new-category-name" className="text-sm font-medium text-foreground">
          Neue Kategorie
        </label>
        <input
          id="new-category-name"
          name="name"
          type="text"
          required
          aria-invalid={state.fieldErrors?.name ? true : undefined}
          className="rounded-md border border-neutral-300 px-3 py-2 text-foreground"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
      >
        {isPending ? "Wird angelegt…" : "Anlegen"}
      </button>
      {state.error ? (
        <p role="alert" className="w-full text-sm text-danger-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
