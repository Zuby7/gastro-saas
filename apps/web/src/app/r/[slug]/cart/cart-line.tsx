"use client";

import { usePreservedFormAction } from "@/lib/forms/use-preserved-form-action";
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
  const [updateState, updateAction, isUpdating] = usePreservedFormAction(
    updateCartItemQuantityAction.bind(null, tenantSlug),
    initialState,
    { resetOnSuccess: false },
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
      className={`flex min-w-0 flex-col gap-3 rounded-lg border p-4 ${
        line.isAvailable ? "border-neutral-200 bg-surface" : "border-danger-500 bg-danger-500/5"
      }`}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="min-w-0 break-words">
        <p className="font-medium text-foreground">
          {line.dishName}
          {line.variantName ? ` (${line.variantName})` : ""}
        </p>
        {line.selections.length > 0 ? (
          <ul className="mt-1 text-sm text-foreground-secondary">
            {line.selections.map((selection) => (
              <li key={selection.optionId}>
                {selection.name}
                {selection.priceDeltaCents !== 0
                  ? ` (${formatPrice(selection.priceDeltaCents, currency)})`
                  : ""}
                {!selection.isAvailable ? " (nicht mehr verfügbar)" : ""}
              </li>
            ))}
          </ul>
        ) : null}

        {!line.isAvailable ? (
          <p className="mt-2 rounded-md border border-danger-500 bg-danger-500/10 px-2 py-1 text-sm font-medium text-danger-foreground">
            Dieses Gericht ist zwischenzeitlich nicht mehr verfügbar. Bitte entfernen Sie es, um
            fortzufahren.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Stepper: each button submits immediately with the new quantity as
            its own `name`/`value` (the preserved-form hook includes the
            submitter). The server action still validates 1..20. */}
        <form {...updateAction} className="flex items-center gap-1">
          <input type="hidden" name="cartItemId" value={line.cartItemId} />
          <button
            type="submit"
            name="quantity"
            value={line.quantity - 1}
            disabled={isUpdating || line.quantity <= 1}
            aria-label={`Menge für ${line.dishName} verringern`}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-neutral-300 text-lg font-medium text-foreground hover:border-ember-400 hover:text-ember-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-700 disabled:opacity-60"
          >
            <span aria-hidden="true">&minus;</span>
          </button>
          <span
            className="min-w-10 text-center font-medium text-foreground"
            aria-label={`Menge für ${line.dishName}: ${line.quantity}`}
          >
            {line.quantity}
          </span>
          <button
            type="submit"
            name="quantity"
            value={line.quantity + 1}
            disabled={isUpdating || line.quantity >= 20}
            aria-label={`Menge für ${line.dishName} erhöhen`}
            className="flex h-11 w-11 items-center justify-center rounded-md border border-neutral-300 text-lg font-medium text-foreground hover:border-ember-400 hover:text-ember-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-700 disabled:opacity-60"
          >
            <span aria-hidden="true">+</span>
          </button>
        </form>

        <p className="ml-auto min-w-20 text-right font-medium text-foreground">
          {formatPrice(line.lineTotalCents, currency)}
        </p>

        <form action={removeAction}>
          <input type="hidden" name="cartItemId" value={line.cartItemId} />
          <button
            type="submit"
            disabled={isRemoving}
            className="min-h-11 rounded-md border border-neutral-300 px-3 py-1 text-sm font-medium text-danger-foreground hover:border-danger-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-700 disabled:opacity-60"
          >
            Entfernen
          </button>
        </form>
      </div>

      {updateState.error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {updateState.error}
        </p>
      ) : null}
      {removeState.error ? (
        <p role="alert" className="text-sm text-danger-foreground">
          {removeState.error}
        </p>
      ) : null}
    </li>
  );
}
