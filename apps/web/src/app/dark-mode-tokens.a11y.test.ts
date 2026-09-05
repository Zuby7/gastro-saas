import { colors, validateContrastRatio, type ContrastTextSize } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * Issue #83: re-enabling automatic OS-driven dark mode (`@media
 * (prefers-color-scheme: dark)` in `globals.css`) required migrating every
 * hardcoded `bg-neutral-0`/`bg-neutral-50`/`bg-neutral-100` usage across
 * `apps/web/src/**` to scheme-aware semantic tokens (`--surface`,
 * `--surface-secondary`, `--surface-muted`, `--danger-foreground`), each
 * paired with a dark-mode value in `globals.css`'s `@media
 * (prefers-color-scheme: dark)` block.
 *
 * This test enumerates every (foreground, background) pair those tokens can
 * actually produce, in both the light (`:root`) and dark (media query)
 * values, and checks each meets WCAG 2.1 AA. Keep in sync with the token
 * values in `apps/web/src/app/globals.css`.
 */

interface TokenPair {
  description: string;
  foreground: string;
  background: string;
  textSize: ContrastTextSize;
}

const lightPairs: TokenPair[] = [
  { description: "foreground on surface (card)", foreground: colors.neutral[900], background: colors.neutral[0], textSize: "normal" },
  { description: "foreground-secondary on surface (card)", foreground: colors.neutral[500], background: colors.neutral[0], textSize: "normal" },
  { description: "link-foreground on surface (card)", foreground: colors.brand[600], background: colors.neutral[0], textSize: "normal" },
  { description: "danger-foreground on surface (card)", foreground: colors.danger[600], background: colors.neutral[0], textSize: "normal" },
  { description: "foreground on surface-secondary (page bg / recessed section)", foreground: colors.neutral[900], background: colors.neutral[50], textSize: "normal" },
  { description: "link-foreground on surface-secondary", foreground: colors.brand[600], background: colors.neutral[50], textSize: "normal" },
  { description: "danger-foreground on surface-secondary", foreground: colors.danger[600], background: colors.neutral[50], textSize: "normal" },
  { description: "foreground on surface-muted (notice box / hover)", foreground: colors.neutral[900], background: colors.neutral[100], textSize: "normal" },
  { description: "danger-foreground on surface-muted", foreground: colors.danger[600], background: colors.neutral[100], textSize: "normal" },
];

const darkPairs: TokenPair[] = [
  { description: "foreground on surface (card, dark)", foreground: colors.neutral[50], background: colors.neutral[800], textSize: "normal" },
  { description: "foreground-secondary on surface (card, dark)", foreground: colors.neutral[300], background: colors.neutral[800], textSize: "normal" },
  { description: "link-foreground on surface (card, dark)", foreground: colors.brand[300], background: colors.neutral[800], textSize: "normal" },
  { description: "danger-foreground on surface (card, dark)", foreground: colors.danger[300], background: colors.neutral[800], textSize: "normal" },
  { description: "foreground on surface-secondary (page bg, dark)", foreground: colors.neutral[50], background: colors.neutral[900], textSize: "normal" },
  { description: "foreground-secondary on surface-secondary (dark)", foreground: colors.neutral[300], background: colors.neutral[900], textSize: "normal" },
  { description: "link-foreground on surface-secondary (dark)", foreground: colors.brand[300], background: colors.neutral[900], textSize: "normal" },
  { description: "danger-foreground on surface-secondary (dark)", foreground: colors.danger[300], background: colors.neutral[900], textSize: "normal" },
  { description: "foreground on surface-muted (dark)", foreground: colors.neutral[50], background: colors.neutral[700], textSize: "normal" },
  { description: "foreground-secondary on surface-muted (dark)", foreground: colors.neutral[300], background: colors.neutral[700], textSize: "normal" },
  { description: "danger-foreground on surface-muted (dark)", foreground: colors.danger[300], background: colors.neutral[700], textSize: "normal" },
  { description: "foreground on background (body, dark)", foreground: colors.neutral[50], background: colors.neutral[900], textSize: "normal" },
];

describe("scheme-aware surface/foreground token pairs (WCAG AA) — light", () => {
  for (const pair of lightPairs) {
    it(`${pair.description} passes AA for ${pair.textSize} text`, () => {
      const result = validateContrastRatio(pair.foreground, pair.background, pair.textSize);
      expect(result.passesAA).toBe(true);
    });
  }
});

describe("scheme-aware surface/foreground token pairs (WCAG AA) — dark (prefers-color-scheme: dark)", () => {
  for (const pair of darkPairs) {
    it(`${pair.description} passes AA for ${pair.textSize} text`, () => {
      const result = validateContrastRatio(pair.foreground, pair.background, pair.textSize);
      expect(result.passesAA).toBe(true);
    });
  }
});
