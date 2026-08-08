"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/public-menu/format";
import type { PublicMenuDish } from "@/lib/public-menu/types";
import { addToCartAction, type CartActionState } from "./cart/actions";

interface DishDetailProps {
  dish: PublicMenuDish;
  tenantSlug: string;
}

const initialCartActionState: CartActionState = {};

export function DishDetail({ dish, tenantSlug }: DishDetailProps) {
  const [selectedVariantId, setSelectedVariantId] = useState(dish.variants[0]?.id ?? "");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});
  // `tenantSlug` is bound server-side (not read from a client-editable form
  // field) -- see the doc comment on `addToCartAction` in `./cart/actions.ts`.
  const boundAddToCartAction = addToCartAction.bind(null, tenantSlug);
  const [state, formAction, isPending] = useActionState(
    boundAddToCartAction,
    initialCartActionState,
  );
  // Screen-reader announcement for the cart change (ticket #20's
  // "Warenkorb-Änderungen werden angesagt" accessibility requirement) --
  // derived directly from action state during render rather than via a
  // setState-in-effect (react-hooks/set-state-in-effect).
  const announcement = state.error
    ? state.error
    : state.cart
      ? `${dish.name} wurde zum Warenkorb hinzugefügt.`
      : "";

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
    <details className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <summary className="cursor-pointer font-medium text-link-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
        Auswählen
      </summary>

      <form action={formAction} className="mt-4 flex flex-col gap-4">
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

        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {state.error ? (
          <p
            role="alert"
            className="rounded-md border border-danger-500 bg-danger-500/10 px-3 py-2 text-sm text-danger-600"
          >
            {state.error}
          </p>
        ) : null}

        {state.cart ? (
          <p className="rounded-md border border-neutral-300 bg-neutral-0 px-3 py-2 text-sm text-foreground">
            Im Warenkorb: {state.cart.itemCount} Artikel ·{" "}
            <Link href={`/r/${tenantSlug}/cart`} className="font-medium text-ember-700 underline">
              Warenkorb ansehen
            </Link>
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!requiredGroupsSatisfied || dish.soldOut || isPending}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-60"
        >
          {isPending ? "Wird hinzugefügt..." : "In den Warenkorb"}
        </button>
      </form>
    </details>
  );
}
