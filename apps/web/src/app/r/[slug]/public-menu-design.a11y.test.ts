import { colors, parseHexColor, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Verifies the color pairs introduced by the 2026-08-08 frontend design
 * pass v2 LAYOUT rework (see `packages/ui/src/tokens.ts` and `page.tsx`)
 * meet WCAG 2.1 AA contrast wherever they're actually rendered on the
 * public menu (`apps/web/src/app/r/[slug]/page.tsx`).
 *
 * The hero is a diagonal `linear-gradient` from `colors.espresso[900]` (deep
 * espresso, the darker stop) to `colors.espresso[800]` (warmer brown). Every
 * hero text/UI-element pair below is checked against the DARKER stop, per
 * this ticket's explicit instruction to treat the worst case as if the whole
 * background were the darkest point of the gradient.
 */
const HERO_DARK_STOP = colors.espresso[900];

function compositeOverBackground(
  foregroundHex: string,
  alpha: number,
  backgroundHex: string,
): string {
  const fg = parseHexColor(foregroundHex);
  const bg = parseHexColor(backgroundHex);
  const blend = (fgChannel: number, bgChannel: number) =>
    Math.round(alpha * fgChannel + (1 - alpha) * bgChannel);
  const toHexChannel = (value: number) => value.toString(16).padStart(2, "0");

  return `#${toHexChannel(blend(fg.r, bg.r))}${toHexChannel(blend(fg.g, bg.g))}${toHexChannel(blend(fg.b, bg.b))}`;
}

describe("public menu hero color contrast (WCAG AA)", () => {
  it("restaurant name (white, large text) on the hero's darkest gradient stop passes AA", () => {
    const result = validateContrastRatio("#ffffff", HERO_DARK_STOP, "large");
    expect(result.passesAA).toBe(true);
  });

  it("tenant description (white/80 over the hero background) on the darkest gradient stop passes AA", () => {
    const composited = compositeOverBackground("#ffffff", 0.8, HERO_DARK_STOP);
    const result = validateContrastRatio(composited, HERO_DARK_STOP);
    expect(result.passesAA).toBe(true);
  });

  it("cart pill text (white) on its translucent white/12 background (composited over the darkest gradient stop) passes AA", () => {
    const pillBackground = compositeOverBackground("#ffffff", 0.12, HERO_DARK_STOP);
    const result = validateContrastRatio("#ffffff", pillBackground);
    expect(result.passesAA).toBe(true);
  });

  it("cart item-count badge text (neutral-900) on its solid gold-300 background passes AA", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.gold[300]);
    expect(result.passesAA).toBe(true);
  });
});

describe("public menu category nav / dish card color contrast (WCAG AA)", () => {
  it("active category tab text (ember-600) on the nav background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.ember[600], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("inactive category tab text (foreground-secondary/neutral-500) on the nav background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.neutral[500], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("dish price (ember-700) on card background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.ember[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("'+' add-to-cart button icon (white) on its solid ember-600 background passes AA (non-text UI component, 3:1 minimum)", () => {
    const result = validateContrastRatio("#ffffff", colors.ember[600], "large");
    expect(result.passesAA).toBe(true);
  });

  it("sold-out badge text (danger-600) on its solid neutral-0 background passes AA (solid, not translucent, so it stays legible over any placeholder gradient)", () => {
    const result = validateContrastRatio(colors.danger[600], colors.neutral[0]);
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
