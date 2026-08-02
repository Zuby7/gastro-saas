"use client";

import { useActionState } from "react";
import { createLookupValueAction, toggleAssignmentAction, type DishActionState } from "./actions";
import type { AssignmentEntity } from "./schemas";

const initialState: DishActionState = {};

export interface LookupItem {
  id: string;
  name: string;
  assigned: boolean;
}

export interface AssignableLookupSectionProps {
  dishId: string;
  entity: AssignmentEntity;
  heading: string;
  newItemLabel: string;
  items: LookupItem[];
}

/**
 * Ticket #14: shared assignment UI for allergens/additives/dietary labels --
 * all three are the same shape (tenant-wide lookup values, per-dish
 * assignment). Labels are explicitly "vom Restaurant angegeben" (restaurant-
 * provided), never a compliance claim, per the ticket's non-goal.
 */
export function AssignableLookupSection({
  dishId,
  entity,
  heading,
  newItemLabel,
  items,
}: AssignableLookupSectionProps) {
  const [toggleState, toggleFormAction] = useActionState(toggleAssignmentAction, initialState);
  const [createState, createFormAction, isCreatePending] = useActionState(
    createLookupValueAction,
    initialState,
  );

  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-300 p-4">
      <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
      <p className="text-sm text-foreground-secondary">
        Angaben werden vom Restaurant gepflegt -- keine automatische Ableitung, keine Rechtsprüfung.
      </p>

      <ul className="flex flex-wrap gap-2" aria-label={heading}>
        {items.map((item) => (
          <li key={item.id}>
            <form action={toggleFormAction}>
              <input type="hidden" name="dishId" value={dishId} />
              <input type="hidden" name="entity" value={entity} />
              <input type="hidden" name="itemId" value={item.id} />
              <input type="hidden" name="assign" value={(!item.assigned).toString()} />
              <button
                type="submit"
                aria-pressed={item.assigned}
                className={`rounded-md border px-2 py-1 text-sm ${
                  item.assigned
                    ? "border-brand-600 bg-brand-600 text-neutral-0"
                    : "border-neutral-300 text-foreground"
                }`}
              >
                {item.name}
              </button>
            </form>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="text-sm text-foreground-secondary">Noch keine Einträge angelegt.</li>
        ) : null}
      </ul>
      {toggleState.error ? (
        <p role="alert" className="text-sm text-danger-600">
          {toggleState.error}
        </p>
      ) : null}

      <form action={createFormAction} className="flex flex-wrap items-end gap-2" noValidate>
        <input type="hidden" name="dishId" value={dishId} />
        <input type="hidden" name="entity" value={entity} />
        <div className="flex flex-col gap-1">
          <label htmlFor={`new-${entity}-name`} className="text-sm font-medium text-foreground">
            {newItemLabel}
          </label>
          <input
            id={`new-${entity}-name`}
            name="name"
            required
            className="rounded-md border border-neutral-300 px-2 py-1 text-foreground"
          />
        </div>
        <button
          type="submit"
          disabled={isCreatePending}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-60"
        >
          {isCreatePending ? "Wird angelegt…" : "Anlegen"}
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
