import type { PublicMenuDish } from "@/lib/public-menu/types";

/**
 * Plain (non-"use client") helpers shared between the Server Component
 * `dish-card.tsx` and the client components in `dish-detail.tsx`. Kept in
 * their own module because a Server Component can't call a plain function
 * exported from a `"use client"` file -- only render its components.
 */

/**
 * A dish with exactly one (or no) variant and no option groups has nothing
 * to choose, so its "+" button can add it directly instead of opening a
 * chooser -- see the ticket's requirement that only multi-variant/
 * multi-option dishes need the inline chooser.
 */
export function isSimpleDish(dish: PublicMenuDish): boolean {
  return dish.variants.length <= 1 && dish.optionGroups.length === 0;
}

/**
 * Shared look for the small round ember "+" trigger (design pass v2 -- see
 * `dish-card.tsx`). Used both as a plain submit button (`SimpleAddButton`,
 * dishes with a single variant and no option groups) and as a purely
 * decorative visual inside the `<summary>` `dish-card.tsx` renders for
 * dishes with variants/options.
 */
export const ADD_BUTTON_CLASSNAME =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember-600 text-neutral-0 transition-colors group-hover:bg-ember-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-700 disabled:cursor-not-allowed disabled:opacity-60";
