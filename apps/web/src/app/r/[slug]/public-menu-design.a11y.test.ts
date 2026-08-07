import { colors, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Verifies the new `clay` accent color pairs introduced by the 2026-08-07
 * frontend design pass (see `packages/ui/src/tokens.ts`) meet WCAG 2.1 AA
 * contrast wherever they're used for text on the public menu
 * (`apps/web/src/app/r/[slug]/page.tsx`).
 *
 * - Dish prices use `font-display font-semibold text-clay-700` (>=18px
 *   semibold), which qualifies as "large text" under WCAG, but is checked
 *   against the stricter normal-text threshold here for a safety margin.
 * - Category nav link hover/focus state uses `text-clay-700` (14px normal
 *   text) on the near-white sticky nav background.
 */
describe("public menu clay accent color contrast (WCAG AA)", () => {
  it("dish price (clay-700) on card background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.clay[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("category nav hover/focus text (clay-700) on nav background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.clay[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("hero rule accent (clay-500) still reads as a distinct, non-decorative-only accent against the paper background (neutral-50) at large-graphic contrast", () => {
    // Decorative (non-text) UI component contrast per WCAG 1.4.11 uses the
    // relaxed 3:1 threshold.
    const result = validateContrastRatio(colors.clay[500], colors.neutral[50], "large");
    expect(result.passesAA).toBe(true);
  });

  it("warm paper background (neutral-50) keeps body text (neutral-900) at AA for normal text", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[50]);
    expect(result.passesAA).toBe(true);
  });

  it("warm paper background (neutral-50) keeps secondary text (neutral-500) at AA for normal text", () => {
    const result = validateContrastRatio(colors.neutral[500], colors.neutral[50]);
    expect(result.passesAA).toBe(true);
  });
});
