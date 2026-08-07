"use client";

import { useActionState } from "react";
import { createVariantAction, deleteVariantAction, type DishActionState } from "./actions";

const initialState: DishActionState = {};

export interface VariantRecord {
  id: string;
  name: string;
  price_cents: number;
}

export function VariantsSection({
  dishId,
  variants,
}: {
  dishId: string;
  variants: VariantRecord[];
}) {
  const [createState, createFormAction, isCreatePending] = useActionState(
    createVariantAction,
    initialState,
  );
  const [deleteState, deleteFormAction] = useActionState(deleteVariantAction, initialState);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-0 p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-foreground">Varianten (Größen)</h2>

      <ul className="flex flex-col gap-2">
        {variants.map((variant) => (
          <li
            key={variant.id}
            className="flex items-center justify-between gap-2 rounded-md border border-neutral-300 p-2"
          >
            <span className="text-foreground">
              {variant.name} -- {(variant.price_cents / 100).toFixed(2)} €
            </span>
            <form action={deleteFormAction}>
              <input type="hidden" name="dishId" value={dishId} />
              <input type="hidden" name="variantId" value={variant.id} />
              <button
                type="submit"
                className="rounded-md border border-danger-500 px-2 py-1 text-sm text-danger-600"
              >
                Entfernen
              </button>
            </form>
          </li>
        ))}
        {variants.length === 0 ? (
          <li className="text-sm text-foreground-secondary">Noch keine Varianten.</li>
        ) : null}
      </ul>
      {deleteState.error ? (
        <p role="alert" className="text-sm text-danger-600">
          {deleteState.error}
        </p>
      ) : null}

      <form action={createFormAction} className="flex flex-wrap items-end gap-2" noValidate>
        <input type="hidden" name="dishId" value={dishId} />
        <div className="flex flex-col gap-1">
          <label htmlFor="variant-name" className="text-sm font-medium text-foreground">
            Name
          </label>
          <input
            id="variant-name"
            name="name"
            required
            className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="variant-price" className="text-sm font-medium text-foreground">
            Preis (Cent)
          </label>
          <input
            id="variant-price"
            name="priceCents"
            type="text"
            inputMode="numeric"
            required
            className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-foreground"
          />
        </div>
        <button
          type="submit"
          disabled={isCreatePending}
          className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-neutral-0 disabled:opacity-60"
        >
          {isCreatePending ? "Wird angelegt…" : "Variante anlegen"}
        </button>
      </form>
      {createState.error ? (
        <p role="alert" className="text-sm text-danger-600">
          {createState.error}
        </p>
      ) : null}
    </section>
  );
}
