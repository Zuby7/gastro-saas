import { Plus } from "lucide-react";
import { formatPrice } from "@/lib/public-menu/format";
import type { PublicMenuDish } from "@/lib/public-menu/types";
import {
  ADD_BUTTON_INTERACTIVE_CLASSNAME,
  ADD_BUTTON_VISUAL_CLASSNAME,
  isSimpleDish,
} from "./dish-add-button";
import { DishOptionChooser, SimpleAddButton } from "./dish-detail";
import { DishPlaceholderIcon } from "./dish-visual";

interface DishCardProps {
  dish: PublicMenuDish;
  tenantSlug: string;
}

/**
 * Dish card (design pass v2 -- see `packages/ui/src/tokens.ts`'s header
 * comment and `page.tsx`'s grid). Server Component: the only interactive
 * pieces (`SimpleAddButton`/`DishOptionChooser`, from `dish-detail.tsx`) are
 * already isolated client components.
 *
 * For dishes with variants/option groups, this card owns the
 * `<details>`/`<summary>` disclosure itself (rather than nesting it inside
 * `DishOptionChooser`) so the whole price/trigger row can be the
 * `<summary>` -- that keeps the expanded chooser panel's width bound to the
 * card's own (grid-column-constrained) width instead of a fixed width that
 * could force the flex/grid item wider than its column and visually
 * overlap the next card.
 */
/**
 * The "starting from" price for a multi-variant/multi-option dish: the
 * dish's own `priceCents` if set, otherwise the cheapest variant's price
 * (there's always at least one variant for a non-simple dish -- see
 * `isSimpleDish`). Shared by the visible price span and the `<summary>`'s
 * `aria-label` so sighted and screen-reader users get the same number (see
 * the a11y fix in `dish-card.tsx`'s disclosure trigger).
 */
function startingPriceCents(dish: PublicMenuDish): number | null {
  if (dish.priceCents !== null) {
    return dish.priceCents;
  }
  if (dish.variants.length === 0) {
    return null;
  }
  return Math.min(...dish.variants.map((variant) => variant.priceCents));
}

/** Human-readable "starting from" price label used in the disclosure's accessible name. */
function startingPriceLabel(dish: PublicMenuDish): string {
  const cents = startingPriceCents(dish);
  if (cents === null) {
    return formatPrice(cents, dish.currency);
  }
  return `ab ${formatPrice(cents, dish.currency)}`;
}

export function DishCard({ dish, tenantSlug }: DishCardProps) {
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-neutral-0 shadow-[0_1px_2px_rgba(0,0,0,.04),0_8px_20px_rgba(0,0,0,.06)]">
      <div
        className={`relative flex h-[120px] w-full items-center justify-center ${
          dish.soldOut
            ? "bg-gradient-to-br from-neutral-200 to-neutral-300"
            : "bg-gradient-to-br from-gold-50 to-ember-100"
        }`}
      >
        {dish.image ? (
          <img
            src={`/media/${dish.image.path}`}
            alt={dish.image.alt}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <DishPlaceholderIcon
            dishName={dish.name}
            className={`h-9 w-9 ${dish.soldOut ? "text-neutral-400" : "text-ember-700/70"}`}
          />
        )}

        {dish.soldOut ? (
          // Solid (not translucent) background so this stays legible
          // regardless of the gray placeholder gradient underneath -- see
          // `public-menu-design.a11y.test.ts` for why a translucent
          // `danger-500/*` overlay wasn't safe here (no danger-50 token
          // exists, and the placeholder's darker gray step failed AA).
          <span className="absolute right-2 top-2 rounded-full border border-danger-500 bg-neutral-0 px-2 py-1 text-xs font-semibold text-danger-600">
            Ausverkauft
          </span>
        ) : null}
      </div>

      <div className={`flex flex-1 flex-col gap-1.5 p-4 ${dish.soldOut ? "opacity-60" : ""}`}>
        <h3 className="text-[15px] font-medium text-foreground">{dish.name}</h3>
        {dish.description ? (
          <p className="line-clamp-3 text-[13px] text-foreground-secondary">{dish.description}</p>
        ) : null}

        {dish.labels.length > 0 ? (
          <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Labels">
            {dish.labels.map((label) => (
              <li
                key={label}
                className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs text-foreground"
              >
                {label}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-xs text-foreground-secondary">{dish.allergenNotice}</p>

        {dish.soldOut ? null : isSimpleDish(dish) ? (
          <div className="mt-auto flex items-center justify-between pt-2">
            <span className="font-display font-bold text-ember-700">
              {formatPrice(dish.priceCents, dish.currency)}
            </span>
            <SimpleAddButton dish={dish} tenantSlug={tenantSlug} />
          </div>
        ) : (
          <details className="group mt-auto pt-2">
            <summary
              aria-label={`${dish.name}, ${startingPriceLabel(dish)}: Auswahl öffnen`}
              className={`flex cursor-pointer list-none items-center justify-between rounded-lg [&::-webkit-details-marker]:hidden ${ADD_BUTTON_INTERACTIVE_CLASSNAME}`}
            >
              <span className="font-display font-bold text-ember-700">
                {formatPrice(startingPriceCents(dish), dish.currency)}
              </span>
              <span className={ADD_BUTTON_VISUAL_CLASSNAME} aria-hidden="true">
                <Plus className="h-4 w-4" />
              </span>
            </summary>
            <div className="mt-3">
              <DishOptionChooser dish={dish} tenantSlug={tenantSlug} />
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
