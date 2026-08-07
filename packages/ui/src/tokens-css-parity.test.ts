import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { colors, spacing, typography } from "./tokens";

/**
 * `theme.css` is hand-maintained in parallel with `tokens.ts` (see the
 * "keep in sync manually" comment at the top of theme.css). This test
 * parses the actual `--*` custom property values out of `theme.css` and
 * asserts they equal the corresponding `tokens.ts` values (not just that a
 * variable with the right name exists), so a drifted value — not just a
 * missing one — is caught. It also checks the reverse direction for the
 * categories covered here (colors, spacing, fontWeight, fontSize): every
 * `--color-*`/`--spacing-*`/`--font-weight-*`/`--font-size-*` custom
 * property in `theme.css` must have a `tokens.ts` counterpart, so orphaned
 * CSS vars are caught too.
 */
const themeCssPath = fileURLToPath(new URL("./theme.css", import.meta.url));
const themeCss = readFileSync(themeCssPath, "utf-8");

/** Parses every `--name: value;` custom property declaration out of a CSS string. */
function parseCssCustomProperties(css: string): Map<string, string> {
  const properties = new Map<string, string>();
  const pattern = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  for (const match of css.matchAll(pattern)) {
    const name = match[1];
    const value = match[2]?.trim();
    if (name && value !== undefined) {
      properties.set(name, value);
    }
  }
  return properties;
}

const cssProperties = parseCssCustomProperties(themeCss);

function expectCssVarValue(name: string, expectedValue: string) {
  expect(cssProperties.has(name), `expected theme.css to define ${name}`).toBe(true);
  expect(cssProperties.get(name), `expected ${name} to match tokens.ts`).toBe(expectedValue);
}

/** CSS custom property name prefixes covered by this parity test. */
const COVERED_PREFIXES = ["--color-", "--spacing-", "--font-weight-", "--font-size-"];

function isCovered(name: string): boolean {
  return COVERED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

describe("tokens.ts <-> theme.css parity", () => {
  it("every color token in tokens.ts has a matching, equal-value CSS var", () => {
    for (const [colorName, shades] of Object.entries(colors)) {
      for (const [shade, value] of Object.entries(shades)) {
        expectCssVarValue(`--color-${colorName}-${shade}`, value);
      }
    }
  });

  it("every spacing token in tokens.ts has a matching, equal-value CSS var", () => {
    for (const [key, value] of Object.entries(spacing)) {
      expectCssVarValue(`--spacing-${key}`, value);
    }
  });

  it("every fontWeight token in tokens.ts has a matching, equal-value CSS var", () => {
    for (const [key, value] of Object.entries(typography.fontWeight)) {
      expectCssVarValue(`--font-weight-${key}`, value);
    }
  });

  it("every fontSize token in tokens.ts has a matching, equal-value CSS var", () => {
    for (const [key, value] of Object.entries(typography.fontSize)) {
      expectCssVarValue(`--font-size-${key}`, value);
    }
  });

  it("has no orphaned color/spacing/fontWeight/fontSize CSS var without a tokens.ts counterpart", () => {
    const expectedNames = new Set<string>();
    for (const [colorName, shades] of Object.entries(colors)) {
      for (const shade of Object.keys(shades)) {
        expectedNames.add(`--color-${colorName}-${shade}`);
      }
    }
    for (const key of Object.keys(spacing)) {
      expectedNames.add(`--spacing-${key}`);
    }
    for (const key of Object.keys(typography.fontWeight)) {
      expectedNames.add(`--font-weight-${key}`);
    }
    for (const key of Object.keys(typography.fontSize)) {
      expectedNames.add(`--font-size-${key}`);
    }

    const orphaned = [...cssProperties.keys()].filter(
      (name) => isCovered(name) && !expectedNames.has(name),
    );

    expect(
      orphaned,
      `unexpected CSS vars with no tokens.ts counterpart: ${orphaned.join(", ")}`,
    ).toEqual([]);
  });
});
