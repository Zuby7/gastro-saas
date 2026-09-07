import { colors, parseHexColor, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Verifies every distinct foreground/background color pair actually
 * rendered by `page.tsx` meets WCAG 2.1 AA contrast, in both the light
 * (`:root`) and dark (`@media (prefers-color-scheme: dark)`) token values.
 *
 * Since issue #83 re-enabled automatic OS-driven dark mode, `page.tsx` uses
 * the scheme-aware `--surface`/`--surface-secondary`/`--background`/
 * `--foreground`/`--foreground-secondary`/`--link-foreground` tokens
 * (`bg-surface`, `bg-surface-secondary`, `bg-background`, `text-foreground`,
 * `text-foreground-secondary`, `text-link-foreground`) for its header,
 * footer, features section, feature cards and the "how it works" section —
 * those pairs are checked below for BOTH schemes, mirroring
 * `dark-mode-tokens.a11y.test.ts`'s pattern. `brand`/`gold`/`ember`/
 * `espresso` are NOT scheme-aware (no dark-mode override in `globals.css`),
 * so the hero (including its ticket-mockup visual anchor), closing CTA band
 * and step badges — all fixed brand/gold/ember/espresso colors — only need a
 * single check, same as `public-menu-design.a11y.test.ts`.
 *
 * Keep this list in sync with `page.tsx`: every text element there should
 * have a corresponding entry below, keyed by the Tailwind class it uses.
 * This is a curated (not auto-scanned) list, but it enumerates the full set
 * of pairs the component renders rather than an arbitrary subset, so a new
 * text element without an accompanying contrast assertion should stand out
 * in review.
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

describe("homepage scheme-aware token pairs (WCAG AA) — light", () => {
  it("header/footer: text-foreground on bg-surface", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("header/footer nav: text-link-foreground on bg-surface", () => {
    const result = validateContrastRatio(colors.brand[600], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("footer: text-foreground-secondary on bg-surface", () => {
    const result = validateContrastRatio(colors.neutral[500], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("features section heading: text-foreground on bg-surface-secondary", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[50]);
    expect(result.passesAA).toBe(true);
  });

  it("features section subheading: text-foreground-secondary on bg-surface-secondary", () => {
    const result = validateContrastRatio(colors.neutral[500], colors.neutral[50]);
    expect(result.passesAA).toBe(true);
  });

  it("feature card: text-foreground on bg-surface", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("feature card: text-foreground-secondary on bg-surface", () => {
    const result = validateContrastRatio(colors.neutral[500], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("'how it works' section: text-foreground on bg-background", () => {
    const result = validateContrastRatio(colors.neutral[900], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("'how it works' section: text-foreground-secondary on bg-background", () => {
    const result = validateContrastRatio(colors.neutral[500], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

});

describe("homepage scheme-aware token pairs (WCAG AA) — dark (prefers-color-scheme: dark)", () => {
  it("header/footer: text-foreground on bg-surface (dark)", () => {
    const result = validateContrastRatio(colors.neutral[50], colors.neutral[800]);
    expect(result.passesAA).toBe(true);
  });

  it("header/footer nav: text-link-foreground on bg-surface (dark)", () => {
    const result = validateContrastRatio(colors.brand[300], colors.neutral[800]);
    expect(result.passesAA).toBe(true);
  });

  it("footer: text-foreground-secondary on bg-surface (dark)", () => {
    const result = validateContrastRatio(colors.neutral[300], colors.neutral[800]);
    expect(result.passesAA).toBe(true);
  });

  it("features section heading: text-foreground on bg-surface-secondary (dark)", () => {
    const result = validateContrastRatio(colors.neutral[50], colors.neutral[900]);
    expect(result.passesAA).toBe(true);
  });

  it("features section subheading: text-foreground-secondary on bg-surface-secondary (dark)", () => {
    const result = validateContrastRatio(colors.neutral[300], colors.neutral[900]);
    expect(result.passesAA).toBe(true);
  });

  it("feature card: text-foreground on bg-surface (dark)", () => {
    const result = validateContrastRatio(colors.neutral[50], colors.neutral[800]);
    expect(result.passesAA).toBe(true);
  });

  it("feature card: text-foreground-secondary on bg-surface (dark)", () => {
    const result = validateContrastRatio(colors.neutral[300], colors.neutral[800]);
    expect(result.passesAA).toBe(true);
  });

  it("'how it works' section (default page background): text-foreground on bg-background (dark)", () => {
    const result = validateContrastRatio(colors.neutral[50], colors.neutral[900]);
    expect(result.passesAA).toBe(true);
  });

  it("'how it works' section (default page background): text-foreground-secondary on bg-background (dark)", () => {
    const result = validateContrastRatio(colors.neutral[300], colors.neutral[900]);
    expect(result.passesAA).toBe(true);
  });
});

describe("homepage fixed-color pairs (WCAG AA) — brand/gold/espresso are not scheme-aware", () => {
  const HERO_WORST_CASE_STOP = colors.espresso[800];

  it("hero h1 (white, large text) on the hero's worst-case (lighter) gradient stop passes AA", () => {
    const result = validateContrastRatio("#ffffff", HERO_WORST_CASE_STOP, "large");
    expect(result.passesAA).toBe(true);
  });

  it("hero subheadline (white/80) on the worst-case (lighter) gradient stop passes AA", () => {
    const composited = compositeOverBackground("#ffffff", 0.8, HERO_WORST_CASE_STOP);
    const result = validateContrastRatio(composited, HERO_WORST_CASE_STOP);
    expect(result.passesAA).toBe(true);
  });

  it("hero secondary 'Anmelden' link (white) on its translucent white/12 background (composited over the worst-case gradient stop) passes AA", () => {
    const pillBackground = compositeOverBackground("#ffffff", 0.12, HERO_WORST_CASE_STOP);
    const result = validateContrastRatio("#ffffff", pillBackground);
    expect(result.passesAA).toBe(true);
  });

  it("header/hero primary CTA text (neutral-0) on its solid brand-600 background passes AA", () => {
    const result = validateContrastRatio(colors.neutral[0], colors.brand[600]);
    expect(result.passesAA).toBe(true);
  });

  it("feature card icon (brand-600) on its solid brand-50 background passes AA (non-text UI, 3:1 minimum)", () => {
    const result = validateContrastRatio(colors.brand[600], colors.brand[50], "large");
    expect(result.passesAA).toBe(true);
  });

  it("'how it works' step number badges (gold-800) on their solid gold-100 background pass AA", () => {
    const result = validateContrastRatio(colors.gold[800], colors.gold[100]);
    expect(result.passesAA).toBe(true);
  });

  it("hero ticket mockup: order line text (neutral-900/500) on its solid surface (neutral-0) passes AA", () => {
    expect(validateContrastRatio(colors.neutral[900], colors.neutral[0]).passesAA).toBe(true);
    expect(validateContrastRatio(colors.neutral[500], colors.neutral[0]).passesAA).toBe(true);
  });

  it("hero ticket mockup: total price (ember-700) on its solid surface (neutral-0) passes AA", () => {
    const result = validateContrastRatio(colors.ember[700], colors.neutral[0]);
    expect(result.passesAA).toBe(true);
  });

  it("hero ticket mockup: '.ticket-stamp' tag text (gold-800) on its solid gold-50 background passes AA", () => {
    const result = validateContrastRatio(colors.gold[800], colors.gold[50]);
    expect(result.passesAA).toBe(true);
  });

  it("closing CTA heading (white, large text) on its solid brand-700 background passes AA", () => {
    const result = validateContrastRatio("#ffffff", colors.brand[700], "large");
    expect(result.passesAA).toBe(true);
  });

  it("closing CTA subheadline (white/85) on its solid brand-700 background passes AA", () => {
    const composited = compositeOverBackground("#ffffff", 0.85, colors.brand[700]);
    const result = validateContrastRatio(composited, colors.brand[700]);
    expect(result.passesAA).toBe(true);
  });

  it("closing CTA button text (brand-700) on its solid brand-50 background passes AA", () => {
    const result = validateContrastRatio(colors.brand[700], colors.brand[50]);
    expect(result.passesAA).toBe(true);
  });
});
