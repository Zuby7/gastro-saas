import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #83 follow-up: the original migration to scheme-aware surface tokens
 * (`bg-surface`, `bg-surface-secondary`, `bg-surface-muted`) missed every
 * `bg-white` usage — Opus review caught ~19 card surfaces still hardcoding
 * `bg-white` combined with `text-foreground`, which reproduces the exact
 * white-on-white unreadable-text bug that caused dark mode to be disabled in
 * the first place (`--foreground` becomes `neutral-50` in dark mode).
 *
 * `dark-mode-tokens.a11y.test.ts` only enumerates token *pairs* and can't
 * catch a hardcoded utility class slipping back into a component, so this
 * test greps the actual source tree for the forbidden literal background
 * utilities and fails the build if any are (re-)introduced.
 *
 * Deliberately excluded:
 *  - `.test.ts(x)` files: test descriptions may reference the token names in
 *    prose without using the literal Tailwind class.
 *  - `bg-white/<opacity>` (e.g. `bg-white/12`) paired with `text-white`:
 *    these are semi-transparent overlay buttons on fixed-color hero banners
 *    (see `r/[slug]/page.tsx`, `checkout/page.tsx`, `cart/page.tsx`), not
 *    scheme-aware card surfaces, and never combine with `text-foreground`.
 */
describe("no hardcoded surface-color utility classes (issue #83 regression guard)", () => {
  const FORBIDDEN_SURFACE_PATTERNS = [
    /\bbg-white\b(?!\/)/, // bare `bg-white`, but not `bg-white/NN` opacity overlays
    /\bbg-neutral-0\b/,
    /\bbg-neutral-50\b/,
    /\bbg-neutral-100\b/,
  ];

  const srcRoot = join(__dirname, ".."); // apps/web/src

  const sourceFiles = (readdirSync(srcRoot, { recursive: true }) as string[])
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .sort();

  it("found source files to check", () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  for (const relativePath of sourceFiles) {
    it(`${relativePath} does not use hardcoded bg-white/bg-neutral-0/50/100`, () => {
      const absolutePath = join(srcRoot, relativePath);
      const contents = readFileSync(absolutePath, "utf8");
      const matches = FORBIDDEN_SURFACE_PATTERNS.flatMap((pattern) => {
        const found = contents.match(new RegExp(pattern, "g"));
        return found ?? [];
      });
      expect(matches).toEqual([]);
    });
  }
});
