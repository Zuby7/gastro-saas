"use client";

import { useActionState } from "react";
import { formatPrice } from "@/lib/public-menu/format";
import type { CartLineView } from "@/lib/cart/types";
import {
  removeCartItemAction,
  updateCartItemQuantityAction,
  type CartActionState,
} from "./actions";

interface CartLineProps {
  line: CartLineView;
  tenantSlug: string;
  currency: string;
}

const initialState: CartActionState = {};

export function CartLine({ line, tenantSlug, currency }: CartLineProps) {
  // `tenantSlug` is bound server-side, not read from a client-editable form
  // field -- see the doc comment on `addToCartAction` in `./actions.ts`.
  const [updateState, updateAction, isUpdating] = useActionState(
    updateCartItemQuantityAction.bind(null, tenantSlug),
    initialState,
  );
  const [removeState, removeAction, isRemoving] = useActionState(
    removeCartItemAction.bind(null, tenantSlug),
    initialState,
  );

  // Screen-reader announcements, derived directly from action state during
  // render (react-hooks/set-state-in-effect) -- "most recent action wins" if
  // both happened to fire, which in practice never overlaps since update and
  // remove are two separate forms/submits.
  const announcement = removeState.error
    ? removeState.error
    : removeState.cart
      ? `${line.dishName} wurde entfernt.`
      : updateState.error
        ? updateState.error
        : updateState.cart
          ? `Menge für ${line.dishName} aktualisiert.`
          : "";

  return (
    <li
      className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${
        line.isAvailable ? "border-neutral-200 bg-neutral-0" : "border-danger-500 bg-danger-500/5"
      }`}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div>
        <p className="font-medium text-foreground">
          {line.dishName}
          {line.variantName ? ` – ${line.variantName}` : ""}
        </p>
        {line.selections.length > 0 ? (
          <ul className="mt-1 text-sm text-foreground-secondary">
            {line.selections.map((selection) => (
              <li key={selection.optionId}>
                {selection.name}
                {selection.priceDeltaCents !== 0
                  ? ` (${formatPrice(selection.priceDeltaCents, currency)})`
                  : ""}
                {!selection.isAvailable ? " – nicht mehr verfügbar" : ""}
              </li>
            ))}
          </ul>
        ) : null}

        {!line.isAvailable ? (
          <p className="mt-2 rounded-md border border-danger-500 bg-danger-500/10 px-2 py-1 text-sm font-medium text-danger-600">
            Dieses Gericht ist zwischenzeitlich nicht mehr verfügbar. Bitte entfernen Sie es, um
            fortzufahren.
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <form action={updateAction} className="flex items-center gap-2">
          <input type="hidden" name="cartItemId" value={line.cartItemId} />
          <label className="sr-only" htmlFor={`quantity-${line.cartItemId}`}>
            Menge für {line.dishName}
          </label>
          <input
            id={`quantity-${line.cartItemId}`}
            name="quantity"
            type="number"
            min={1}
            max={20}
            defaultValue={line.quantity}
            className="w-16 rounded-md border border-neutral-300 px-2 py-1 text-sm text-foreground"
          />
          <button
            type="submit"
            disabled={isUpdating}
            className="rounded-md border border-neutral-300 px-3 py-1 text-sm font-medium text-foreground hover:border-ember-400 hover:text-ember-700 disabled:opacity-60"
          >
            Aktualisieren
          </button>
        </form>

        <p className="w-24 text-right font-medium text-foreground">
          {formatPrice(line.lineTotalCents, currency)}
        </p>

        <form action={removeAction}>
          <input type="hidden" name="cartItemId" value={line.cartItemId} />
          <button
            type="submit"
            disabled={isRemoving}
            className="rounded-md border border-neutral-300 px-3 py-1 text-sm font-medium text-danger-600 hover:border-danger-500 disabled:opacity-60"
          >
            Entfernen
          </button>
        </form>
      </div>

      {updateState.error ? (
        <p role="alert" className="text-sm text-danger-600">
          {updateState.error}
        </p>
      ) : null}
      {removeState.error ? (
        <p role="alert" className="text-sm text-danger-600">
          {removeState.error}
        </p>
      ) : null}
    </li>
  );
}
