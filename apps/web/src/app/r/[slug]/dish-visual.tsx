import { GlassWater, IceCreamCone, Pizza, Salad, Soup, UtensilsCrossed } from "lucide-react";

interface DishPlaceholderIconProps {
  dishName: string;
  className?: string;
}

/**
 * Icon-per-dish heuristic for the placeholder image area (design pass v2 --
 * see `dish-card.tsx`'s dish card grid). Dishes don't carry a structured
 * "kind" field, so this pattern-matches on the dish name only -- it never
 * invents data, it just picks a reasonable icon from a small fixed set when
 * no real photo (`dish.image`) exists. Falls back to a generic dish icon
 * when nothing matches.
 *
 * Implemented as a component that renders each statically-imported icon
 * directly as a JSX tag per branch (rather than selecting a component into
 * a variable and rendering that), which is the pattern
 * `react-hooks/static-components` expects -- see this repo's lint config.
 */
export function DishPlaceholderIcon({ dishName, className }: DishPlaceholderIconProps) {
  if (/pizza/i.test(dishName)) {
    return <Pizza className={className} aria-hidden="true" />;
  }
  if (/(salat|salad|bowl)/i.test(dishName)) {
    return <Salad className={className} aria-hidden="true" />;
  }
  if (/(pasta|nudel|spaghetti|penne|lasagne|tagliatelle|tortellini|ravioli)/i.test(dishName)) {
    return <Soup className={className} aria-hidden="true" />;
  }
  if (
    /(getränk|drink|wasser|acqua|cola|saft|succo|wein|vino|wine|bier|beer|birra|limonade|softdrink)/i.test(
      dishName,
    )
  ) {
    return <GlassWater className={className} aria-hidden="true" />;
  }
  if (/(dessert|eis|kuchen|tiramisu|panna\s?cotta|torte|süß)/i.test(dishName)) {
    return <IceCreamCone className={className} aria-hidden="true" />;
  }
  return <UtensilsCrossed className={className} aria-hidden="true" />;
}
