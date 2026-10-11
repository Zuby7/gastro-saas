import { colors, parseHexColor, validateContrastRatio } from "@gastro-saas/ui";
import { describe, expect, it } from "vitest";

/**
 * WCAG 2.1 AA contrast for every text/background pair on the landing page
 * (`page.tsx`, `landing.css`, `--lp-*` tokens in `globals.css`), in the light
 * (`:root`) and dark (`prefers-color-scheme: dark`) scheme.
 *
 * Text over translucent/gradient layers is checked against the WORST case:
 * every decorative glow (`--lp-glow-*`) is composited over the page
 * background at its real alpha (and all three stacked), and glass surfaces
 * (`--lp-glass`, 72% surface) are composited over those results. Text on the
 * header bar and the closing band is checked against EVERY gradient stop.
 * Keep the alphas below in sync with `globals.css`.
 */

type Rgb = { r: number; g: number; b: number };

function toRgb(hex: string): Rgb {
  return parseHexColor(hex);
}

function mix(fg: string | Rgb, alpha: number, bg: string | Rgb): Rgb {
  const f = typeof fg === "string" ? toRgb(fg) : fg;
  const b = typeof bg === "string" ? toRgb(bg) : bg;
  const blend = (x: number, y: number) => Math.round(alpha * x + (1 - alpha) * y);
  return { r: blend(f.r, b.r), g: blend(f.g, b.g), b: blend(f.b, b.b) };
}

function hex({ r, g, b }: Rgb): string {
  const c = (v: number) => v.toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function ok(fg: string | Rgb, bg: string | Rgb, size: "normal" | "large" = "normal") {
  const f = typeof fg === "string" ? fg : hex(fg);
  const b = typeof bg === "string" ? bg : hex(bg);
  const result = validateContrastRatio(f, b, size);
  return { passes: result.passesAA, ratio: result.ratio };
}

const SCHEMES = {
  light: {
    background: colors.neutral[0],
    surface: colors.neutral[0],
    foreground: colors.neutral[900],
    secondary: colors.neutral[500],
    muted: colors.neutral[600],
    link: colors.brand[600],
    accent: colors.ember[700],
    textFrom: colors.brand[600],
    textTo: colors.ember[500],
    glare: 0.26,
    glows: [
      { color: colors.brand[400], alpha: 0.26 },
      { color: colors.ember[300], alpha: 0.26 },
      { color: colors.gold[200], alpha: 0.34 },
    ],
  },
  dark: {
    background: colors.neutral[900],
    surface: colors.neutral[800],
    foreground: colors.neutral[50],
    secondary: colors.neutral[300],
    muted: colors.neutral[200],
    link: colors.brand[300],
    accent: colors.ember[200],
    textFrom: colors.brand[300],
    textTo: colors.ember[300],
    glare: 0.12,
    glows: [
      { color: colors.brand[500], alpha: 0.24 },
      { color: colors.ember[500], alpha: 0.24 },
      { color: colors.gold[400], alpha: 0.2 },
    ],
  },
} as const;

/** Page-background variants: plain, each glow alone, every overlapping pair. */
function pageBackgrounds(scheme: (typeof SCHEMES)[keyof typeof SCHEMES]): Rgb[] {
  const plain = toRgb(scheme.background);
  const single = scheme.glows.map((g) => mix(g.color, g.alpha, plain));
  // Two glows can overlap behind the same text (never all three: they are
  // placed in different corners of different sections), so test every pair.
  const pairs: Rgb[] = [];
  for (const [i, a] of scheme.glows.entries()) {
    for (const b of scheme.glows.slice(i + 1)) {
      pairs.push(mix(b.color, b.alpha, mix(a.color, a.alpha, plain)));
      pairs.push(mix(a.color, a.alpha, mix(b.color, b.alpha, plain)));
    }
  }
  return [plain, ...single, ...pairs];
}

const GLASS_ALPHA = 0.72;

for (const [name, scheme] of Object.entries(SCHEMES)) {
  describe(`landing page contrast, ${name} scheme`, () => {
    const backgrounds = pageBackgrounds(scheme);

    it("body text (foreground, lp-muted) on page background incl. every glow", () => {
      for (const bg of backgrounds) {
        expect(ok(scheme.foreground, bg).passes).toBe(true);
        expect(ok(scheme.muted, bg).passes).toBe(true);
      }
    });

    it("eyebrow labels (accent) on page background incl. every glow", () => {
      for (const bg of backgrounds) {
        expect(ok(scheme.accent, bg).passes).toBe(true);
      }
    });

    it("gradient headline text (both gradient stops, large text) on page background incl. every glow", () => {
      for (const bg of backgrounds) {
        expect(ok(scheme.textFrom, bg, "large").passes).toBe(true);
        expect(ok(scheme.textTo, bg, "large").passes).toBe(true);
      }
    });

    it("glass cards and chips: text on 72% surface over page background incl. every glow", () => {
      for (const bg of backgrounds) {
        const glass = mix(scheme.surface, GLASS_ALPHA, bg);
        expect(ok(scheme.foreground, glass).passes).toBe(true);
        expect(ok(scheme.muted, glass).passes).toBe(true);
        expect(ok(scheme.link, glass).passes).toBe(true);
        expect(ok(scheme.accent, glass).passes).toBe(true);
      }
    });

    it("holo cards: text on solid surface, also under the hover glare and sheen layers", () => {
      const surface = toRgb(scheme.surface);
      // Sheen (16% holo tint) and hover glare (`--lp-glare`: 26% light / 12% dark gold-200, 10% holo) are
      // overlays on the card: test them alone and combined.
      const sheenEmber = mix(colors.ember[300], 0.16, surface);
      const sheenBrand = mix(colors.brand[400], 0.16, surface);
      const variants = [
        surface,
        sheenEmber,
        sheenBrand,
        mix(colors.gold[200], scheme.glare, surface),
        mix(colors.gold[200], scheme.glare, sheenEmber),
        mix(colors.gold[200], scheme.glare, sheenBrand),
      ];
      for (const bg of variants) {
        expect(ok(scheme.foreground, bg).passes).toBe(true);
        expect(ok(scheme.muted, bg).passes).toBe(true);
        expect(ok(scheme.accent, bg).passes).toBe(true);
      }
    });

    it("links (4.5:1) on plain background and surface; icons and focus ring (3:1) on every glow", () => {
      for (const bg of [backgrounds[0]!, toRgb(scheme.surface)]) {
        expect(ok(scheme.link, bg).passes).toBe(true);
      }
      for (const bg of backgrounds) {
        expect(ok(scheme.link, bg, "large").passes).toBe(true);
      }
    });

    it("footer: secondary text and links on surface", () => {
      expect(ok(scheme.secondary, scheme.surface).passes).toBe(true);
      expect(ok(scheme.link, scheme.surface).passes).toBe(true);
    });
  });
}

describe("landing page fixed-color pairs (not scheme-aware)", () => {
  const barStops = [colors.espresso[900], colors.espresso[800], colors.ember[700]];
  const bandStops = [colors.brand[800], colors.espresso[900], colors.ember[700]];

  it("header bar: white logo and links on every gradient stop", () => {
    for (const stop of barStops) {
      expect(ok(colors.neutral[0], stop).passes).toBe(true);
    }
  });

  it("header bar: white text on the white/12 'Login' pill over every gradient stop", () => {
    for (const stop of barStops) {
      expect(ok(colors.neutral[0], mix(colors.neutral[0], 0.12, stop)).passes).toBe(true);
      // hover state white/20
      expect(ok(colors.neutral[0], mix(colors.neutral[0], 0.2, stop)).passes).toBe(true);
    }
  });

  it("header 'Registrieren' CTA: brand-800 on brand-50 (and brand-100 hover)", () => {
    expect(ok(colors.brand[800], colors.brand[50]).passes).toBe(true);
    expect(ok(colors.brand[800], colors.brand[100]).passes).toBe(true);
  });

  it("glowing primary button: white on both gradient stops (brand-700, brand-600)", () => {
    expect(ok(colors.neutral[0], colors.brand[700]).passes).toBe(true);
    expect(ok(colors.neutral[0], colors.brand[600]).passes).toBe(true);
  });

  it("closing band: white heading (large), white/90 copy, white outline button on every stop", () => {
    for (const stop of bandStops) {
      expect(ok(colors.neutral[0], stop, "large").passes).toBe(true);
      expect(ok(mix(colors.neutral[0], 0.9, stop), stop).passes).toBe(true);
      expect(ok(colors.neutral[0], mix(colors.neutral[0], 0.12, stop)).passes).toBe(true);
      expect(ok(colors.neutral[0], mix(colors.neutral[0], 0.2, stop)).passes).toBe(true);
    }
  });

  it("closing band: brand-800 button text on brand-50 / brand-100", () => {
    expect(ok(colors.brand[800], colors.brand[50]).passes).toBe(true);
    expect(ok(colors.brand[800], colors.brand[100]).passes).toBe(true);
  });

  it("white focus-ring alternative: gold-300 outline on every bar/band stop is >= 3:1", () => {
    for (const stop of [...barStops, ...bandStops]) {
      expect(ok(colors.gold[300], stop, "large").passes).toBe(true);
    }
  });
});
