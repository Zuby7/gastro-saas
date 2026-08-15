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
 * Shared *visual* look for the small round ember "+" trigger (design pass v2
 * -- see `dish-card.tsx`). Deliberately excludes `focus-visible`/`disabled`
 * treatment: those only make sense on the actually-focusable/disableable
 * element, not on a purely decorative `aria-hidden` span (see
 * `ADD_BUTTON_INTERACTIVE_CLASSNAME` for that half).
 */
export const ADD_BUTTON_VISUAL_CLASSNAME =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember-600 text-neutral-0 transition-colors group-hover:bg-ember-700";

/**
 * Focus-visible/disabled treatment, meant for the real interactive element
 * (a `<button>` or, for the multi-variant dish card, the `<summary>` itself)
 * -- never for a decorative `aria-hidden` span, which can never receive
 * focus or the `disabled` attribute in the first place.
 */
export const ADD_BUTTON_INTERACTIVE_CLASSNAME =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-700 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Full look for a real `<button>` trigger (`SimpleAddButton`): visual +
 * interactive treatment combined.
 */
export const ADD_BUTTON_CLASSNAME = `${ADD_BUTTON_VISUAL_CLASSNAME} ${ADD_BUTTON_INTERACTIVE_CLASSNAME}`;
