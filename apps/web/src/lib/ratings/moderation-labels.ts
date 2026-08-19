import type { RatingModerationStatus } from "./types";

/** German label for a moderation status (ticket #34's ausstehend/freigegeben/verborgen). */
export function ratingModerationStatusLabel(status: RatingModerationStatus): string {
  switch (status) {
    case "pending":
      return "Ausstehend";
    case "released":
      return "Freigegeben";
    case "hidden":
      return "Verborgen";
    default:
      return status;
  }
}
