import { colors, validateContrastRatio, type ContrastTextSize } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Verifies every distinct foreground/background color pair actually
 * rendered by `page.tsx` (see `globals.css` for how each CSS custom
 * property resolves per color scheme) meets WCAG 2.1 AA contrast, in both
 * light and dark color schemes.
 *
 * Keep this list in sync with `page.tsx`: every text element there should
 * have a corresponding entry below, keyed by the Tailwind class it uses.
 * This is a curated (not auto-scanned) list, but it enumerates the full set
 * of pairs the component renders rather than an arbitrary subset, so a new
 * text element without an accompanying contrast assertion should stand out
 * in review.
 */
interface RenderedTextPair {
  /** Human-readable description, matched to the element in page.tsx. */
  description: string;
  light: { foreground: string; background: string };
  dark: { foreground: string; background: string };
  /**
   * "h1" (text-3xl font-semibold, 30px) qualifies as WCAG "large text"
   * (>=18.66px), so the relaxed 3:1 threshold applies. Everything else on
   * the page renders at 16px or smaller (normal text), which needs 4.5:1.
   */
  textSize: ContrastTextSize;
}

const renderedTextPairs: RenderedTextPair[] = [
  {
    description: "h1 (text-foreground on background)",
    light: { foreground: colors.neutral[900], background: colors.neutral[0] },
    dark: { foreground: colors.neutral[50], background: colors.neutral[900] },
    textSize: "large",
  },
  {
    description: "p (text-foreground-secondary on background)",
    light: { foreground: colors.neutral[500], background: colors.neutral[0] },
    dark: { foreground: colors.neutral[300], background: colors.neutral[900] },
    textSize: "normal",
  },
  {
    description:
      "nav links 'Restaurant registrieren' / 'Anmelden' (text-link-foreground on background, text-sm)",
    light: { foreground: colors.brand[600], background: colors.neutral[0] },
    dark: { foreground: colors.brand[300], background: colors.neutral[900] },
    textSize: "normal",
  },
];

describe("homepage color contrast (WCAG AA)", () => {
  for (const pair of renderedTextPairs) {
    it(`light mode: ${pair.description} passes AA for ${pair.textSize} text`, () => {
      const result = validateContrastRatio(pair.light.foreground, pair.light.background, pair.textSize);
      expect(result.passesAA).toBe(true);
    });

    it(`dark mode: ${pair.description} passes AA for ${pair.textSize} text`, () => {
      const result = validateContrastRatio(pair.dark.foreground, pair.dark.background, pair.textSize);
      expect(result.passesAA).toBe(true);
    });
  }
});
