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

/**
 * Moderation queue (ticket #34). `pending`: newly submitted, not yet
 * reviewed. `released`: reviewed and safe to show publicly (once a future
 * ticket adds a public display surface). `hidden`: reviewed and suppressed.
 */
export type RatingModerationStatus = "pending" | "released" | "hidden";

/** One row of the `reviews.read`-gated admin moderation list. */
export interface ModerationQueueRatingView {
  ratingId: string;
  stars: number;
  comment: string;
  ratedAt: string;
  status: RatingModerationStatus;
  moderatedByUserId: string | null;
  moderatedAt: string | null;
}

/** Shape returned by the `moderate_rating` RPC. */
export interface ModerateRatingResult {
  ratingId: string;
  status: RatingModerationStatus;
}
