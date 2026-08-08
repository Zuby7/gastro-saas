import { colors, parseHexColor, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Verifies the actual foreground/background color pairs the cart page and
 * its `CartLine` rows render (see `page.tsx`/`cart-line.tsx`, Epic 6,
 * ticket #20) meet WCAG 2.1 AA contrast. Added for the epic-6 batch review's
 * finding 2 (no automated a11y coverage for the epic's new customer-facing
 * surfaces).
 *
 * `bg-danger-500/10` is a translucent overlay, not a solid color -- to test
 * the *actual rendered* contrast rather than a tautological "danger-600 on
 * danger-500" pair, this composites `danger-500` at 10% opacity over the
 * page's real background (`neutral-50`) using the same sRGB math
 * `validateContrastRatio` uses internally, then checks the danger text color
 * against that composited result.
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
 * The header now uses the same quiet hero-gradient treatment as the public
 * menu page (see `../public-menu-design.a11y.test.ts` and `../page.tsx`'s
 * header comment) -- checked against `espresso[800]`, the LIGHTER of the two
 * gradient stops, which is the worst case for light/white text (a lighter
 * background gives white text less contrast, not more).
 */
const HERO_WORST_CASE_STOP = colors.espresso[800];

describe("cart page header color contrast (WCAG AA)", () => {
  it("'Warenkorb' heading (white, large text) on the header's worst-case (lighter) gradient stop passes AA", () => {
    const result = validateContrastRatio("#ffffff", HERO_WORST_CASE_STOP, "large");
    expect(result.passesAA).toBe(true);
  });

  it("tenant name subtext (white/80 over the header background) on the worst-case (lighter) gradient stop passes AA", () => {
    const composited = compositeOverBackground("#ffffff", 0.8, HERO_WORST_CASE_STOP);
    const result = validateContrastRatio(composited, HERO_WORST_CASE_STOP);
    expect(result.passesAA).toBe(true);
  });

  it("'Zurück zur Speisekarte' pill text (white) on its translucent white/12 background (composited over the worst-case (lighter) gradient stop) passes AA", () => {
    const pillBackground = compositeOverBackground("#ffffff", 0.12, HERO_WORST_CASE_STOP);
    const result = validateContrastRatio("#ffffff", pillBackground);
    expect(result.passesAA).toBe(true);
  });
});

describe("cart page color contrast (WCAG AA)", () => {
  it("total-sum price (ember-700) on the card/page background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.ember[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("cart-line unavailable-item warning text (danger-600) on its translucent danger-500/10 background (composited over the neutral-0 card) passes AA", () => {
    const composited = compositeOverBackground(colors.danger[500], 0.1, colors.neutral[0]);
    const result = validateContrastRatio(colors.danger[600], composited);
    expect(result.passesAA).toBe(true);
  });

  it("cart's page-level 'unavailable items' alert text (danger-600) on its translucent danger-500/10 background (composited over the neutral-50 page background) passes AA", () => {
    const composited = compositeOverBackground(colors.danger[500], 0.1, colors.neutral[50]);
    const result = validateContrastRatio(colors.danger[600], composited);
    expect(result.passesAA).toBe(true);
  });

  it("empty-cart message text (foreground/neutral-900) on the neutral-0 card passes AA", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });
});
