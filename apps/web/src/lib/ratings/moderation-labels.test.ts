import { describe, expect, it } from "vitest";
import { ratingModerationStatusLabel } from "./moderation-labels";
import type { RatingModerationStatus } from "./types";

describe("ratingModerationStatusLabel", () => {
  it.each<[RatingModerationStatus, string]>([
    ["pending", "Ausstehend"],
    ["released", "Freigegeben"],
    ["hidden", "Verborgen"],
  ])("%s -> %s", (status, label) => {
    expect(ratingModerationStatusLabel(status)).toBe(label);
  });

  it("falls back to the raw value for unknown statuses", () => {
    expect(ratingModerationStatusLabel("x" as RatingModerationStatus)).toBe("x");
  });
});
