import { colors, parseHexColor, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Verifies the actual foreground/background color pairs the guest-facing
 * order-status page renders (Epic 6, ticket #22), including the
 * "order not found" state, meet WCAG 2.1 AA contrast. Added for the epic-6
 * batch review's finding 2.
 */

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

/**
 * The (found-order) header now uses the same quiet hero-gradient treatment
 * as the public menu page (see `../../public-menu-design.a11y.test.ts` and
 * `../../page.tsx`'s header comment) -- checked against `espresso[800]`, the
 * LIGHTER of the two gradient stops, which is the worst case for light/white
 * text (a lighter background gives white text less contrast, not more). The
 * "not found" state's `<main>` is untouched by this pass and keeps its own
 * `neutral-50` background, covered further below.
 */
const HERO_WORST_CASE_STOP = colors.espresso[800];

describe("order-status page header color contrast (WCAG AA)", () => {
  it("'Bestellstatus' heading (white, large text) on the header's worst-case (lighter) gradient stop passes AA", () => {
    const result = validateContrastRatio("#ffffff", HERO_WORST_CASE_STOP, "large");
    expect(result.passesAA).toBe(true);
  });

  it("tenant name subtext (white/80 over the header background) on the worst-case (lighter) gradient stop passes AA", () => {
    const composited = compositeOverBackground("#ffffff", 0.8, HERO_WORST_CASE_STOP);
    const result = validateContrastRatio(composited, HERO_WORST_CASE_STOP);
    expect(result.passesAA).toBe(true);
  });
});

describe("order-status page color contrast (WCAG AA)", () => {
  it("live status label (ember-700) on the status card background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.ember[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("total-sum price (ember-700) on the order-items card background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.ember[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("ticket-stamp order number badge text (gold-800) on its gold-50 background passes AA", () => {
    const result = validateContrastRatio(colors.gold[800], colors.gold[50]);
    expect(result.passesAA).toBe(true);
  });

  it("'not found' heading/body text (foreground/foreground-secondary) on the page background (neutral-50) passes AA", () => {
    const heading = validateContrastRatio(colors.neutral[900], colors.neutral[50]);
    const body = validateContrastRatio(colors.neutral[500], colors.neutral[50]);
    expect(heading.passesAA).toBe(true);
    expect(body.passesAA).toBe(true);
  });

  it("'back to menu' link text (ember-700) on the page background (neutral-50) passes AA", () => {
    const result = validateContrastRatio(colors.ember[700], colors.neutral[50]);
    expect(result.passesAA).toBe(true);
  });
});
