// Server-side cart price recalculation (Epic 6, ticket #20).
//
// This is the canonical, pure representation of the price-recalculation
// algorithm the database RPC `recalculate_cart_view` (see
// supabase/migrations/*_cart_server_side_pricing.sql) performs against live
// menu data on every cart read/mutation. It is intentionally DB-free so it
// can be unit tested directly (per the ticket's "Unit-Test
// Preisneuberechnung" requirement) without a Postgres instance.
//
// The acceptance criterion this encodes: the total shown to a customer is
// always a fresh recalculation from *current* line inputs (never a
// client-supplied total), and any line whose dish/variant/option is no
// longer available is excluded from the total and flagged rather than
// silently trusted.
//
// This module never receives a client-calculated price or total as input --
// callers must resolve `unitPriceCents`/`priceDeltaCents` from the live
// menu/pricing tables (or, in tests, from fixture data standing in for that
// live lookup) before calling `calculateCartPricing`.

export interface CartLineSelectionInput {
  optionId: string;
  /** Current live price delta for this option, in minor currency units (cents). */
  priceDeltaCents: number;
  /** False if the option (or its group assignment) no longer exists/resolves against the live menu. */
  isAvailable: boolean;
}

export interface CartLineInput {
  cartItemId: string;
  quantity: number;
  /** Current live unit price (dish or variant), in minor currency units (cents). */
  unitPriceCents: number;
  /** False if the dish/variant is archived, sold out, or no longer part of the published menu version. */
  isAvailable: boolean;
  selections: CartLineSelectionInput[];
}

export interface CartPricingInput {
  currency: string;
  lines: CartLineInput[];
}

export interface CartLineResult {
  cartItemId: string;
  quantity: number;
  unitPriceCents: number;
  selectionsTotalCents: number;
  /** (unitPriceCents + selectionsTotalCents) * quantity. Always 0 for unavailable lines. */
  lineTotalCents: number;
  isAvailable: boolean;
}

export interface CartPricingResult {
  currency: string;
  lines: CartLineResult[];
  /** Sum of `lineTotalCents` across available lines only -- never includes unavailable lines. */
  totalCents: number;
  itemCount: number;
  hasUnavailableItems: boolean;
  /** True only when the cart has at least one line and every line is available. */
  checkoutReady: boolean;
}

/**
 * Recomputes every cart line's total from its current (live) unit price and
 * selection deltas, and sums an overall cart total that only ever includes
 * available lines. Never trusts a precomputed/stored total -- always derives
 * it fresh from the inputs given.
 */
export function calculateCartPricing(input: CartPricingInput): CartPricingResult {
  const lines: CartLineResult[] = input.lines.map((line) => {
    const selectionsTotalCents = line.selections.reduce(
      (sum, selection) => sum + selection.priceDeltaCents,
      0,
    );
    const lineIsAvailable = line.isAvailable && line.selections.every((s) => s.isAvailable);
    const lineTotalCents = lineIsAvailable
      ? (line.unitPriceCents + selectionsTotalCents) * line.quantity
      : 0;

    return {
      cartItemId: line.cartItemId,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      selectionsTotalCents,
      lineTotalCents,
      isAvailable: lineIsAvailable,
    };
  });

  const totalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const hasUnavailableItems = lines.some((line) => !line.isAvailable);

  return {
    currency: input.currency,
    lines,
    totalCents,
    itemCount: lines.length,
    hasUnavailableItems,
    checkoutReady: lines.length > 0 && !hasUnavailableItems,
  };
}
