"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { formatPrice } from "@/lib/public-menu/format";
import type { PublicMenuDish } from "@/lib/public-menu/types";
import { addToCartAction, type CartActionState } from "./cart/actions";
import { ADD_BUTTON_CLASSNAME } from "./dish-add-button";

interface DishDetailProps {
  dish: PublicMenuDish;
  tenantSlug: string;
}

const initialCartActionState: CartActionState = {};

function useCartFeedback(dish: PublicMenuDish, tenantSlug: string, state: CartActionState) {
  const announcement = state.error
    ? state.error
    : state.cart
      ? `${dish.name} wurde zum Warenkorb hinzugefügt.`
      : "";

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {state.error ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-danger-500 bg-danger-500/10 px-3 py-2 text-sm text-danger-foreground"
        >
          {state.error}
        </p>
      ) : null}

      {state.cart ? (
        <p className="mt-2 rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-foreground">
          Im Warenkorb: {state.cart.itemCount} Artikel ·{" "}
          <Link href={`/r/${tenantSlug}/cart`} className="font-medium text-ember-700 underline">
            Warenkorb ansehen
          </Link>
        </p>
      ) : null}
    </>
  );
}

/**
 * Direct-add trigger for simple dishes (see `isSimpleDish`) -- a plain form
 * with the dish's (only) variant/no options pre-selected, submitted by the
 * round "+" button itself. Everything about the server action call
 * (`addToCartAction`, validation, the screen-reader announcement) is
 * unchanged from before this presentation-layer pass.
 */
export function SimpleAddButton({ dish, tenantSlug }: DishDetailProps) {
  const boundAddToCartAction = addToCartAction.bind(null, tenantSlug);
  const [state, formAction, isPending] = useActionState(
    boundAddToCartAction,
    initialCartActionState,
  );
  const feedback = useCartFeedback(dish, tenantSlug, state);
  const variantId = dish.variants[0]?.id ?? "";

  return (
    <form action={formAction} className="flex flex-col items-end">
      <input type="hidden" name="dishId" value={dish.id} />
      <input type="hidden" name="dishVariantId" value={variantId} />
      <input type="hidden" name="quantity" value="1" />
      <input type="hidden" name="optionIds" value="[]" />
      <button
        type="submit"
        disabled={dish.soldOut || isPending}
        aria-label={`${dish.name} zum Warenkorb hinzufügen`}
        className={ADD_BUTTON_CLASSNAME}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
      {feedback}
    </form>
  );
}

/**
 * Variant/option-group chooser for dishes that aren't "simple" (see
 * `isSimpleDish`). Rendered by `dish-card.tsx` inside a `<details>` it owns
 * itself (so the disclosure's `<summary>` can span the dish's whole
 * price/trigger row without this panel's width fighting the card's grid
 * column -- see that file's comment for why). This component only renders
 * the panel's contents; the disclosure open/close chrome lives in the
 * caller.
 */
export function DishOptionChooser({ dish, tenantSlug }: DishDetailProps) {
  const [selectedVariantId, setSelectedVariantId] = useState(dish.variants[0]?.id ?? "");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});
  // `tenantSlug` is bound server-side (not read from a client-editable form
  // field) -- see the doc comment on `addToCartAction` in `./cart/actions.ts`.
  const boundAddToCartAction = addToCartAction.bind(null, tenantSlug);
  const [state, formAction, isPending] = useActionState(
    boundAddToCartAction,
    initialCartActionState,
  );
  const feedback = useCartFeedback(dish, tenantSlug, state);

  const selectedVariant = dish.variants.find((variant) => variant.id === selectedVariantId);
  const basePrice = selectedVariant?.priceCents ?? dish.priceCents ?? 0;

  const allSelectedOptionIds = useMemo(
    () => Object.values(selectedOptions).flat(),
    [selectedOptions],
  );

  const optionTotal = useMemo(
    () =>
      dish.optionGroups.reduce((total, group) => {
        const selected = selectedOptions[group.id] ?? [];
        return (
          total +
          group.options
            .filter((option) => selected.includes(option.id))
            .reduce((sum, option) => sum + option.priceDeltaCents, 0)
        );
      }, 0),
    [dish.optionGroups, selectedOptions],
  );

  const requiredGroupsSatisfied = dish.optionGroups.every((group) => {
    const count = selectedOptions[group.id]?.length ?? 0;
    return count >= group.minSelections && count <= group.maxSelections;
  });

  function toggleOption(groupId: string, optionId: string, maxSelections: number) {
    setSelectedOptions((current) => {
      const existing = current[groupId] ?? [];
      const next = existing.includes(optionId)
        ? existing.filter((id) => id !== optionId)
        : [...existing, optionId].slice(0, maxSelections);
      return { ...current, [groupId]: next };
    });
  }

  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-md border border-neutral-200 bg-surface-secondary p-3"
    >
      <input type="hidden" name="dishId" value={dish.id} />
      <input type="hidden" name="dishVariantId" value={selectedVariantId} />
      <input type="hidden" name="quantity" value="1" />
      <input type="hidden" name="optionIds" value={JSON.stringify(allSelectedOptionIds)} />

      {dish.variants.length > 0 ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium text-foreground">Variante</legend>
          {dish.variants.map((variant) => (
            <label key={variant.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                <input
                  className="mr-2"
                  type="radio"
                  name={`variant-${dish.id}`}
                  value={variant.id}
                  checked={selectedVariantId === variant.id}
                  onChange={() => setSelectedVariantId(variant.id)}
                />
                {variant.name}
              </span>
              <span>{formatPrice(variant.priceCents, variant.currency)}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {dish.optionGroups.map((group) => {
        const selectedCount = selectedOptions[group.id]?.length ?? 0;
        return (
          <fieldset key={group.id} className="flex flex-col gap-2">
            <legend className="font-medium text-foreground">
              {group.name}{" "}
              <span className="text-sm font-normal text-foreground-secondary">
                {group.minSelections > 0 ? `mind. ${group.minSelections}, ` : ""}
                max. {group.maxSelections}
              </span>
            </legend>
            {group.options.map((option) => (
              <label key={option.id} className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <input
                    className="mr-2"
                    type="checkbox"
                    checked={(selectedOptions[group.id] ?? []).includes(option.id)}
                    disabled={
                      !(selectedOptions[group.id] ?? []).includes(option.id) &&
                      selectedCount >= group.maxSelections
                    }
                    onChange={() => toggleOption(group.id, option.id, group.maxSelections)}
                  />
                  {option.name}
                </span>
                <span>{formatPrice(option.priceDeltaCents, option.currency)}</span>
              </label>
            ))}
          </fieldset>
        );
      })}

      <div className="flex items-center justify-between border-t border-neutral-300 pt-3">
        <span className="font-medium">Vorschau</span>
        <span>
          {formatPrice(basePrice + optionTotal, selectedVariant?.currency ?? dish.currency)}
        </span>
      </div>

      {feedback}

      <button
        type="submit"
        disabled={!requiredGroupsSatisfied || dish.soldOut || isPending}
        className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
      >
        {isPending ? "Wird hinzugefügt..." : "In den Warenkorb"}
      </button>
    </form>
  );
}
