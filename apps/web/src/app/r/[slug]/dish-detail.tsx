"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePreservedFormAction } from "@/lib/forms/use-preserved-form-action";
import { Plus, X } from "lucide-react";
import { formatPrice } from "@/lib/public-menu/format";
import type { PublicMenuDish } from "@/lib/public-menu/types";
import { addToCartAction, type CartActionState } from "./cart/actions";
import { ADD_BUTTON_CLASSNAME } from "./dish-add-button";

interface DishDetailProps {
  dish: PublicMenuDish;
  tenantSlug: string;
}

const initialCartActionState: CartActionState = {};

/** How long the success confirmation stays visible before it dismisses itself. */
const CONFIRMATION_DISMISS_MS = 3000;

/**
 * `floating`: when true, the visible error/success message is positioned
 * `absolute bottom-full right-0` above the `relative` price/button row the
 * caller provides, so it never grows that row (an in-flow message pushed the
 * row and the card taller than its CSS Grid track, overlapping the
 * neighboring card -- live bug 2026-09-08) and, unlike the earlier
 * `inset-0` overlay, never covers the price or the "+" button, so the guest
 * can add the dish again right away. `DishOptionChooser`'s panel is a
 * full-width disclosure with room to grow, so it keeps the in-flow
 * (non-floating) placement.
 *
 * The success confirmation dismisses itself after ~3 s and can be closed
 * manually; errors stay until closed or the next submit. No animation is
 * used, so `prefers-reduced-motion` is respected by construction.
 */
function useCartFeedback(
  dish: PublicMenuDish,
  tenantSlug: string,
  state: CartActionState,
  floating: boolean,
) {
  const [dismissedState, setDismissedState] = useState<CartActionState | null>(null);

  useEffect(() => {
    if (!state.cart || state.error) {
      return;
    }
    const timer = setTimeout(() => setDismissedState(state), CONFIRMATION_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const dismissed = dismissedState === state;

  const announcement = state.error
    ? state.error
    : state.cart
      ? `${dish.name} wurde zum Warenkorb hinzugefügt.`
      : "";

  const messageClassName = floating
    ? "absolute bottom-full right-0 z-10 mb-1 flex max-w-full items-center gap-1 overflow-hidden"
    : "mt-2 flex items-center gap-1";

  const closeButton = (
    <button
      type="button"
      onClick={() => setDismissedState(state)}
      aria-label="Meldung schließen"
      className="-my-2 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-700"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {state.error && !dismissed ? (
        <div
          role="alert"
          className={`${messageClassName} rounded-md border border-danger-500 bg-danger-500/10 px-3 py-2 text-sm text-danger-foreground shadow-sm`}
        >
          <span>{state.error}</span>
          {closeButton}
        </div>
      ) : null}

      {state.cart && !dismissed ? (
        <div
          className={`${messageClassName} rounded-md border border-neutral-300 bg-surface px-3 py-2 text-sm text-foreground shadow-sm`}
        >
          <span>
            Im Warenkorb: {state.cart.itemCount} Artikel ·{" "}
            <Link
              href={`/r/${tenantSlug}/cart`}
              className="inline-block py-2 font-medium text-accent-foreground underline"
            >
              Warenkorb ansehen
            </Link>
          </span>
          {closeButton}
        </div>
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
  const feedback = useCartFeedback(dish, tenantSlug, state, true);
  const variantId = dish.variants[0]?.id ?? "";

  return (
    // No `relative` here -- the ancestor price/button row (dish-card.tsx)
    // provides the positioning context so the floating confirmation sits
    // above that whole row, not just this form's own (shrink-to-fit) box.
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
  const defaultVariantId = dish.variants[0]?.id ?? "";
  // After a successful add the visible form AND the React state (preview
  // price, hidden `optionIds`) must agree. The hook's automatic
  // `form.reset()` only clears the DOM of these controlled inputs, leaving the
  // state (and so the next add) with the old extras -- so reset is disabled
  // and the state is cleared explicitly, which re-renders the inputs unticked.
  const [state, formAction, isPending] = usePreservedFormAction(
    async (previous: CartActionState, formData: FormData) => {
      const next = await boundAddToCartAction(previous, formData);
      if (!next.error && next.cart) {
        setSelectedVariantId(defaultVariantId);
        setSelectedOptions({});
      }
      return next;
    },
    initialCartActionState,
    { resetOnSuccess: false },
  );
  const feedback = useCartFeedback(dish, tenantSlug, state, false);

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
      {...formAction}
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
            <label
              key={variant.id}
              className="flex min-h-11 items-center justify-between gap-3 text-sm"
            >
              <span className="flex items-center">
                <input
                  className="mr-3 h-5 w-5 shrink-0"
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
              <label
                key={option.id}
                className="flex min-h-11 items-center justify-between gap-3 text-sm"
              >
                <span className="flex items-center">
                  <input
                    className="mr-3 h-5 w-5 shrink-0"
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
        className="min-h-11 rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
      >
        {isPending ? "Wird hinzugefügt..." : "In den Warenkorb"}
      </button>
    </form>
  );
}
