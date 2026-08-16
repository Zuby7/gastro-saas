import { colors, validateContrastRatio, type ContrastTextSize } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Verifies every distinct foreground/background color pair actually
 * rendered by `page.tsx` meets WCAG 2.1 AA contrast.
 *
 * Light mode only: automatic OS-driven dark mode was removed from
 * `globals.css` (see that file's comment) because almost every surface in
 * this app hardcodes light-mode utility classes (`bg-neutral-0`, etc.)
 * rather than the `--background`/`--foreground` variables, so flipping just
 * those two root variables produced invisible text on still-white cards
 * instead of a real dark theme. Re-add dark-mode assertions here only once
 * a real, fully-audited dark mode ships.
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
  foreground: string;
  background: string;
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
    foreground: colors.neutral[900],
    background: colors.neutral[0],
    textSize: "large",
  },
  {
    description: "p (text-foreground-secondary on background)",
    foreground: colors.neutral[500],
    background: colors.neutral[0],
    textSize: "normal",
  },
  {
    description:
      "nav links 'Restaurant registrieren' / 'Anmelden' (text-link-foreground on background, text-sm)",
    foreground: colors.brand[600],
    background: colors.neutral[0],
    textSize: "normal",
  },
];

describe("homepage color contrast (WCAG AA)", () => {
  for (const pair of renderedTextPairs) {
    it(`${pair.description} passes AA for ${pair.textSize} text`, () => {
      const result = validateContrastRatio(pair.foreground, pair.background, pair.textSize);
      expect(result.passesAA).toBe(true);
    });
  }
});
