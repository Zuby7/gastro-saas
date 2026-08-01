import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { colors, spacing, typography } from "./tokens";

/**
 * `theme.css` is hand-maintained in parallel with `tokens.ts` (see the
 * "keep in sync manually" comment at the top of theme.css). This test
 * fails whenever a color/spacing/fontWeight token in `tokens.ts` doesn't
 * have a matching `--*` custom property in `theme.css`, so drift between
 * the two is caught instead of silently shipped.
 */
const themeCssPath = fileURLToPath(new URL("./theme.css", import.meta.url));
const themeCss = readFileSync(themeCssPath, "utf-8");

function expectCssVar(name: string) {
  const pattern = new RegExp(`(^|\\s)${name}\\s*:`);
  expect(themeCss, `expected theme.css to define ${name}`).toMatch(pattern);
}

describe("tokens.ts <-> theme.css parity", () => {
  it("has a CSS custom property for every color token", () => {
    for (const [colorName, shades] of Object.entries(colors)) {
      for (const shade of Object.keys(shades)) {
        expectCssVar(`--color-${colorName}-${shade}`);
      }
    }
  });

  it("has a CSS custom property for every spacing token", () => {
    for (const key of Object.keys(spacing)) {
      expectCssVar(`--spacing-${key}`);
    }
  });

  it("has a CSS custom property for every fontWeight token", () => {
    for (const key of Object.keys(typography.fontWeight)) {
      expectCssVar(`--font-weight-${key}`);
    }
  });
});
