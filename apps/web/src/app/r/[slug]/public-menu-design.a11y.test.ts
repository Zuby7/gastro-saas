import { colors, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Verifies the `ember` accent color pairs introduced by the 2026-08-08
 * frontend design pass v2 (see `packages/ui/src/tokens.ts`) meet WCAG 2.1 AA
 * contrast wherever they're used for text on the public menu
 * (`apps/web/src/app/r/[slug]/page.tsx`).
 *
 * - Dish prices use `font-display font-semibold text-ember-700` (>=18px
 *   semibold), which qualifies as "large text" under WCAG, but is checked
 *   against the stricter normal-text threshold here for a safety margin.
 * - Category nav link hover/focus state uses `text-ember-700` (14px normal
 *   text) on the near-white sticky nav background.
 *
 * The previous pass's decorative hero-rule accent was removed in the v2
 * redesign (see the design plan's self-critique), so there is no longer a
 * decorative/large-graphic contrast case to check here.
 */
describe("public menu ember accent color contrast (WCAG AA)", () => {
  it("dish price (ember-700) on card background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.ember[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("category nav hover/focus text (ember-700) on nav background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.ember[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("warm stone background (neutral-50) keeps body text (neutral-900) at AA for normal text", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[50]);
    expect(result.passesAA).toBe(true);
  });

  it("warm stone background (neutral-50) keeps secondary text (neutral-500) at AA for normal text", () => {
    const result = validateContrastRatio(colors.neutral[500], colors.neutral[50]);
    expect(result.passesAA).toBe(true);
  });
});
