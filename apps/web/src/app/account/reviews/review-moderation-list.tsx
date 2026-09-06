"use client";

import { useCallback, useState, useTransition } from "react";
import type { ModerationQueueRatingView, RatingModerationStatus } from "@/lib/ratings/types";
import { ratingModerationStatusLabel } from "@/lib/ratings/moderation-labels";
import { formatOrderTimestamp } from "@/lib/orders/format";
import { moderateRatingAction } from "./actions";

interface ReviewModerationListProps {
  initialRatings: ModerationQueueRatingView[];
  /**
   * Whether the current member holds `reviews.moderate` (resolved
   * server-side in `page.tsx`). Purely a UX affordance -- hides the
   * status-change buttons for a member who can't use them -- never the
   * actual authorization boundary: `moderateRatingAction` re-checks
   * `reviews.moderate` server-side on every call regardless of this prop.
   */
  canModerate: boolean;
}

const MODERATION_ACTIONS: { status: RatingModerationStatus; label: string }[] = [
  { status: "released", label: "Freigeben" },
  { status: "hidden", label: "Verbergen" },
  { status: "pending", label: "Zurückstellen" },
];

/**
 * Admin moderation queue (ticket #34). No polling/realtime -- unlike the
 * live order dashboard, a moderation backlog is not a "watch it change in
 * real time" surface; the list simply re-renders from the server action's
 * result after each decision.
 */
export function ReviewModerationList({ initialRatings, canModerate }: ReviewModerationListProps) {
  const [ratings, setRatings] = useState(initialRatings);
  const [error, setError] = useState<string | null>(null);
  const [pendingRatingId, setPendingRatingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleModerate = useCallback((ratingId: string, status: RatingModerationStatus) => {
    setError(null);
    setPendingRatingId(ratingId);
    startTransition(async () => {
      const result = await moderateRatingAction(ratingId, status);
      setPendingRatingId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setRatings((current) =>
        current.map((rating) =>
          rating.ratingId === ratingId && result.status
            ? { ...rating, status: result.status }
            : rating,
        ),
      );
    });
  }, []);

  if (ratings.length === 0) {
    return <p className="text-sm text-foreground-secondary">Noch keine Bewertungen vorhanden.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-500 bg-surface p-3 text-sm text-danger-foreground"
        >
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {ratings.map((rating) => (
          <li
            key={rating.ratingId}
            className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-surface p-4 text-sm text-foreground"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium" aria-label={`${rating.stars} von 5 Sternen`}>
                {"★".repeat(rating.stars)}
                {"☆".repeat(5 - rating.stars)}
              </span>
              <span className="text-xs text-foreground-secondary">
                {formatOrderTimestamp(rating.ratedAt)}
              </span>
            </div>

            {rating.comment ? <p>{rating.comment}</p> : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className="w-fit rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-foreground"
                data-testid={`status-${rating.ratingId}`}
              >
                {ratingModerationStatusLabel(rating.status)}
              </span>

              {canModerate ? (
                <div className="flex flex-wrap gap-2">
                  {MODERATION_ACTIONS.filter((action) => action.status !== rating.status).map(
                    (action) => (
                      <button
                        key={action.status}
                        type="button"
                        disabled={isPending && pendingRatingId === rating.ratingId}
                        onClick={() => handleModerate(rating.ratingId, action.status)}
                        aria-label={`Bewertung mit ${rating.stars} Sternen: ${action.label}`}
                        className="min-h-11 rounded-md border border-neutral-300 bg-surface px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {action.label}
                      </button>
                    ),
                  )}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
