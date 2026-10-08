import { colors, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/** WCAG AA contrast for the color pairs the digital receipt page (#153) renders. */
describe("receipt page color contrast (WCAG AA)", () => {
  it("primary text (neutral-900) on the receipt card (neutral-0) passes AA", () => {
    expect(validateContrastRatio(colors.neutral[900], colors.neutral[0]).passesAA).toBe(true);
  });

  it("secondary text/legal note (neutral-500) on the receipt card (neutral-0) passes AA", () => {
    expect(validateContrastRatio(colors.neutral[500], colors.neutral[0]).passesAA).toBe(true);
  });

  it("secondary text (neutral-500) on the page background (neutral-50) passes AA", () => {
    expect(validateContrastRatio(colors.neutral[500], colors.neutral[50]).passesAA).toBe(true);
  });

  it("print button label (white) on ember-700 passes AA", () => {
    expect(validateContrastRatio("#ffffff", colors.ember[700]).passesAA).toBe(true);
  });

  it("back link (ember-700) on the page background (neutral-50) passes AA", () => {
    expect(validateContrastRatio(colors.ember[700], colors.neutral[50]).passesAA).toBe(true);
  });
});
