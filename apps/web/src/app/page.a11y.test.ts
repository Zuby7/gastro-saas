import { colors, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Verifies the actual foreground/background color pairs the homepage
 * renders (see `globals.css` and `page.tsx`) meet WCAG 2.1 AA contrast in
 * both light and dark color schemes.
 *
 * - `h1` uses `text-3xl font-semibold` (30px), which qualifies as "large
 *   text" under WCAG (>=18.66px), so the relaxed 3:1 threshold applies.
 * - `p` uses `text-base` (16px normal text), so the stricter 4.5:1
 *   threshold applies.
 */
describe("homepage color contrast (WCAG AA)", () => {
  it("light mode: heading (neutral-900 on neutral-0) passes AA for large text", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[0], "large");
    expect(result.passesAA).toBe(true);
  });

  it("light mode: body text (neutral-500 on neutral-0) passes AA for normal text", () => {
    const result = validateContrastRatio(colors.neutral[500], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("dark mode: heading (neutral-50 on neutral-900) passes AA for large text", () => {
    const result = validateContrastRatio(colors.neutral[50], colors.neutral[900], "large");
    expect(result.passesAA).toBe(true);
  });

  it("dark mode: body text (neutral-300 on neutral-900) passes AA for normal text", () => {
    const result = validateContrastRatio(colors.neutral[300], colors.neutral[900]);
    expect(result.passesAA).toBe(true);
  });
});
