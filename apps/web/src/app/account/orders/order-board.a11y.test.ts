import { colors, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Ticket #27 (Live-Order-Dashboard): locks in WCAG AA contrast for the
 * actually-rendered color pairs on the order board's cards -- following the
 * pattern established in
 * `apps/web/src/app/r/[slug]/orders/[token]/order-status-page-design.a11y.test.ts`.
 */
describe("order board color contrast (WCAG AA)", () => {
  it("column heading (foreground/neutral-900) on white cards passes AA", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("secondary text (foreground-secondary/neutral-500, e.g. order count and timestamp) on white cards passes AA", () => {
    const result = validateContrastRatio(colors.neutral[500], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("payment-status badge text (foreground/neutral-900) on its neutral-100 pill background passes AA", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[100]);
    expect(result.passesAA).toBe(true);
  });

  it("'Mehr laden' load-more button text (foreground/neutral-900) on its neutral-0 background passes AA", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("ticket #28: status-change action button text (white) on its brand-600 background passes AA", () => {
    const result = validateContrastRatio(colors.neutral[0], colors.brand[600]);
    expect(result.passesAA).toBe(true);
  });

  it("ticket #28: transition-error alert text (danger-600) on its neutral-0 background passes AA", () => {
    const result = validateContrastRatio(colors.danger[600], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });
});
