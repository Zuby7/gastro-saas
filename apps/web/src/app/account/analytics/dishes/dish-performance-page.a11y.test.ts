import { colors, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Ticket #31: verifies the distinct foreground/background color pairs
 * actually rendered by `page.tsx` meet WCAG 2.1 AA contrast, following the
 * pattern established by `account/analytics/analytics-page.a11y.test.ts`.
 * Every text element on this page (including table cells) renders at 16px
 * or smaller (normal text), so the stricter 4.5:1 threshold applies
 * throughout.
 */
describe("dish performance page color contrast (WCAG AA)", () => {
  it("text-foreground on bg-neutral-50 (page background) passes AA for normal text", () => {
    expect(validateContrastRatio(colors.neutral[900], colors.neutral[50], "normal").passesAA).toBe(
      true,
    );
  });

  it("text-foreground on bg-surface (table cards) passes AA for normal text", () => {
    expect(validateContrastRatio(colors.neutral[900], colors.neutral[0], "normal").passesAA).toBe(
      true,
    );
  });

  it("link color (text-link-foreground on bg-neutral-50/white) passes AA for normal text", () => {
    expect(validateContrastRatio(colors.brand[600], colors.neutral[50], "normal").passesAA).toBe(
      true,
    );
    expect(validateContrastRatio(colors.brand[600], colors.neutral[0], "normal").passesAA).toBe(
      true,
    );
  });
});
