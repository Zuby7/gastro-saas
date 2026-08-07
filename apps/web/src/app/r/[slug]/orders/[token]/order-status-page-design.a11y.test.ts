import { colors, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Verifies the actual foreground/background color pairs the guest-facing
 * order-status page renders (Epic 6, ticket #22), including the
 * "order not found" state, meet WCAG 2.1 AA contrast. Added for the epic-6
 * batch review's finding 2.
 */
describe("order-status page color contrast (WCAG AA)", () => {
  it("live status label (clay-700) on the status card background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.clay[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("total-sum price (clay-700) on the order-items card background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.clay[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("'not found' heading/body text (foreground/foreground-secondary) on the page background (neutral-50) passes AA", () => {
    const heading = validateContrastRatio(colors.neutral[900], colors.neutral[50]);
    const body = validateContrastRatio(colors.neutral[500], colors.neutral[50]);
    expect(heading.passesAA).toBe(true);
    expect(body.passesAA).toBe(true);
  });

  it("'back to menu' link text (clay-700) on the page background (neutral-50) passes AA", () => {
    const result = validateContrastRatio(colors.clay[700], colors.neutral[50]);
    expect(result.passesAA).toBe(true);
  });
});
