import { colors, validateContrastRatio } from "@gastro-saas/ui";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ticket #162: contrast for the colors the consent banner/dialog and the
 * Datenschutz cookie table use, in the light scheme and in the
 * `prefers-color-scheme: dark` scheme. Token mapping is read from
 * `globals.css` so a remapped token fails here instead of silently drifting.
 */
const css = readFileSync(join(__dirname, "..", "..", "globals.css"), "utf8");
const darkBlock = css.slice(css.indexOf("prefers-color-scheme: dark"));

function tokenTarget(source: string, token: string): string {
  const match = new RegExp(`--${token}:\\s*var\\(--color-([a-z]+)-(\\d+)\\)`).exec(source);
  if (!match) {
    throw new Error(`token --${token} not found`);
  }
  const family = match[1] as keyof typeof colors;
  const shade = match[2]!;
  const hex = (colors[family] as Record<string, string>)[shade];
  if (!hex) {
    throw new Error(`no color ${family}-${shade}`);
  }
  return hex;
}

const schemes = [
  { name: "light", source: css.slice(0, css.indexOf("prefers-color-scheme: dark")) },
  { name: "dark", source: darkBlock },
];

describe.each(schemes)("consent UI contrast ($name scheme)", ({ source }) => {
  it("body/button text (foreground) on the banner/dialog surface passes AA", () => {
    expect(
      validateContrastRatio(tokenTarget(source, "foreground"), tokenTarget(source, "surface"))
        .passesAA,
    ).toBe(true);
  });

  it("button text on hover (surface-muted) passes AA", () => {
    expect(
      validateContrastRatio(tokenTarget(source, "foreground"), tokenTarget(source, "surface-muted"))
        .passesAA,
    ).toBe(true);
  });

  it("links (link-foreground) on the surface and on the page background pass AA", () => {
    const link = tokenTarget(source, "link-foreground");
    expect(validateContrastRatio(link, tokenTarget(source, "surface")).passesAA).toBe(true);
    expect(validateContrastRatio(link, tokenTarget(source, "surface-secondary")).passesAA).toBe(
      true,
    );
  });

  it("button border (foreground) vs. surface meets the 3:1 UI-component contrast", () => {
    const result = validateContrastRatio(
      tokenTarget(source, "foreground"),
      tokenTarget(source, "surface"),
      "large",
    );
    expect(result.passesAA).toBe(true);
  });

  it("table text (foreground) on the Datenschutz page background (surface-secondary) passes AA", () => {
    expect(
      validateContrastRatio(
        tokenTarget(source, "foreground"),
        tokenTarget(source, "surface-secondary"),
      ).passesAA,
    ).toBe(true);
  });

  it("focus outline (link-foreground) reaches 3:1 against surface and surface-secondary", () => {
    const outline = tokenTarget(source, "link-foreground");
    for (const bg of ["surface", "surface-secondary"]) {
      expect(validateContrastRatio(outline, tokenTarget(source, bg), "large").passesAA).toBe(true);
    }
  });

  it("link hover colour (foreground) passes AA on surface, surface-muted and surface-secondary", () => {
    const hover = tokenTarget(source, "foreground");
    for (const bg of ["surface", "surface-muted", "surface-secondary"]) {
      expect(validateContrastRatio(hover, tokenTarget(source, bg)).passesAA).toBe(true);
    }
  });
});

describe("consent UI classes use scheme-aware tokens only", () => {
  it("does not use fixed brand-700 for outline or hover", () => {
    const src = readFileSync(join(__dirname, "cookie-consent-banner.tsx"), "utf8");
    expect(src).not.toMatch(/outline-brand-700|hover:text-brand-700/);
  });
});
