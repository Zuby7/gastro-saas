"use client";

import { useMemo, useState } from "react";
import { formatPrice } from "@/lib/public-menu/format";
import type { PublicMenuDish } from "@/lib/public-menu/types";

interface DishDetailProps {
  dish: PublicMenuDish;
}

export function DishDetail({ dish }: DishDetailProps) {
  const [selectedVariantId, setSelectedVariantId] = useState(dish.variants[0]?.id ?? "");
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string[]>>({});

  const selectedVariant = dish.variants.find((variant) => variant.id === selectedVariantId);
  const basePrice = selectedVariant?.priceCents ?? dish.priceCents ?? 0;
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
    <details className="mt-3 rounded-md border border-neutral-300 p-3">
      <summary className="cursor-pointer font-medium text-brand-600">Auswählen</summary>

      <div className="mt-4 flex flex-col gap-4">
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

        <button
          type="button"
          disabled={!requiredGroupsSatisfied || dish.soldOut}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-neutral-0 disabled:opacity-60"
        >
          In den Warenkorb
        </button>
      </div>
    </details>
  );
}
