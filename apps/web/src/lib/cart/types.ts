export interface CartLineSelectionView {
  optionId: string;
  name: string;
  priceDeltaCents: number;
  isAvailable: boolean;
}

export interface CartLineView {
  cartItemId: string;
  dishId: string;
  dishName: string;
  variantId: string | null;
  variantName: string | null;
  quantity: number;
  unitPriceCents: number;
  selections: CartLineSelectionView[];
  selectionsTotalCents: number;
  lineTotalCents: number;
  isAvailable: boolean;
}

/**
 * Shape returned by the `get_cart_view`/`add_cart_item`/
 * `update_cart_item_quantity`/`remove_cart_item` RPCs (see
 * supabase/migrations/20260803090000_cart_server_side_pricing.sql's
 * `build_cart_view`). `totalCents` and every line's `lineTotalCents` are
 * always a fresh server-side recalculation -- this type is never
 * constructed from client input.
 */
export interface CartView {
  cartId: string;
  currency: string;
  items: CartLineView[];
  totalCents: number;
  itemCount: number;
  hasUnavailableItems: boolean;
  checkoutReady: boolean;
}
