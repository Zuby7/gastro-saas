import { colors, parseHexColor, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Verifies the actual foreground/background color pairs the checkout page
 * and `CheckoutForm` render (Epic 6, ticket #21) meet WCAG 2.1 AA contrast,
 * for both the happy-path form and its error/blocked-cart states. Added for
 * the epic-6 batch review's finding 2.
 *
 * See `../cart/cart-page-design.a11y.test.ts` for the compositing rationale
 * behind checking `danger-600` text against the actual translucent
 * `danger-500/10` background rather than a tautological solid-color pair.
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
 * header comment) -- checked against the darker of the two gradient stops.
 */
const HERO_DARK_STOP = "#2b1c14";

describe("checkout page header color contrast (WCAG AA)", () => {
  it("'Kasse' heading (white, large text) on the header's darkest gradient stop passes AA", () => {
    const result = validateContrastRatio("#ffffff", HERO_DARK_STOP, "large");
    expect(result.passesAA).toBe(true);
  });

  it("tenant name subtext (white/80 over the header background) on the darkest gradient stop passes AA", () => {
    const composited = compositeOverBackground("#ffffff", 0.8, HERO_DARK_STOP);
    const result = validateContrastRatio(composited, HERO_DARK_STOP);
    expect(result.passesAA).toBe(true);
  });

  it("'Zurück zum Warenkorb' pill text (white) on its translucent white/12 background (composited over the darkest gradient stop) passes AA", () => {
    const pillBackground = compositeOverBackground("#ffffff", 0.12, HERO_DARK_STOP);
    const result = validateContrastRatio("#ffffff", pillBackground);
    expect(result.passesAA).toBe(true);
  });
});

describe("checkout page color contrast (WCAG AA)", () => {
  it("total-sum price (ember-700) on the summary bar background (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.ember[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("field labels/input text (foreground/neutral-900) on the page background (neutral-50) passes AA", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[50]);
    expect(result.passesAA).toBe(true);
  });

  it("submit-error banner text (danger-600) on its translucent danger-500/10 background (composited over neutral-50) passes AA -- pickup variant", () => {
    const composited = compositeOverBackground(colors.danger[500], 0.1, colors.neutral[50]);
    const result = validateContrastRatio(colors.danger[600], composited);
    expect(result.passesAA).toBe(true);
  });

  it("blocked-cart banner text (danger-600) on its translucent danger-500/10 background (composited over neutral-50) passes AA -- table variant", () => {
    // Same token pair renders for both fulfillment-type variants (the
    // blocked-cart banner isn't fulfillment-type-specific), verified
    // explicitly for both per the ticket's guidance to cover "both
    // fulfillment-type variants (pickup and table)".
    const composited = compositeOverBackground(colors.danger[500], 0.1, colors.neutral[50]);
    const result = validateContrastRatio(colors.danger[600], composited);
    expect(result.passesAA).toBe(true);
  });

  it("primary submit button text (neutral-0) on brand-600 passes AA", () => {
    const result = validateContrastRatio(colors.neutral[0], colors.brand[600]);
    expect(result.passesAA).toBe(true);
  });
});
