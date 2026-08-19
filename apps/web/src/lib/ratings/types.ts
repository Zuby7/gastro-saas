/**
 * Customer-safe rating shape (ticket #33). Deliberately just enough to
 * render "you already rated this order" on the guest order-status page --
 * no tenant-wide aggregate/admin fields here (ticket #34's non-goal).
 */
export interface OrderRatingView {
  stars: number;
  comment: string;
  createdAt: string;
}

export interface SubmitOrderRatingInput {
  guestAccessTokenHash: string;
  stars: number;
  comment: string;
}

/** Shape returned by the `submit_order_rating` RPC. */
export interface SubmitOrderRatingResult {
  ratingId: string;
  stars: number;
  comment: string;
  createdAt: string;
}
