"use client";

import Link from "next/link";
import { useActionState } from "react";
import { archiveDishAction, type MenuActionState } from "./actions";

const initialState: MenuActionState = {};

export interface DishRowProps {
  id: string;
  name: string;
  priceCents: number | null;
  allergenReviewed: boolean;
}

export function DishRow({ id, name, priceCents, allergenReviewed }: DishRowProps) {
  const [state, formAction] = useActionState(archiveDishAction, initialState);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 bg-surface-secondary p-2">
      <div>
        <Link
          href={`/account/menu/dishes/${id}`}
          className="font-medium text-link-foreground underline"
        >
          {name}
        </Link>
        <span className="ml-2 text-sm text-foreground-secondary">
          {priceCents !== null ? `${(priceCents / 100).toFixed(2)} €` : "kein Grundpreis"}
        </span>
        {!allergenReviewed ? (
          <span className="ml-2 rounded-md border border-warning-500 px-1.5 py-0.5 text-xs text-warning-600">
            Allergen-Prüfung fehlt
          </span>
        ) : null}
      </div>
      <form action={formAction}>
        <input type="hidden" name="dishId" value={id} />
        <button
          type="submit"
          className="rounded-md border border-danger-500 px-2 py-1 text-sm text-danger-foreground"
        >
          Archivieren
        </button>
      </form>
      {state.error ? (
        <span role="alert" className="w-full text-sm text-danger-foreground">
          {state.error}
        </span>
      ) : null}
    </li>
  );
}
