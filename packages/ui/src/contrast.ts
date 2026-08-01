/**
 * WCAG 2.x contrast-ratio validation.
 *
 * Used to validate tenant-branding color inputs (see
 * `.claude/rules/frontend.md`: "Tenant branding customization must never be
 * allowed to break accessibility") before they are accepted, so branding UI
 * tickets don't have to re-derive the WCAG math ad hoc.
 *
 * Reference: https://www.w3.org/TR/WCAG21/#contrast-minimum
 */

export type ContrastTextSize = "normal" | "large";

export interface ContrastResult {
  /** Contrast ratio between 1 and 21, rounded to 2 decimal places. */
  ratio: number;
  /** Whether the ratio meets WCAG 2.1 level AA for the given text size. */
  passesAA: boolean;
  /** Whether the ratio meets the stricter WCAG 2.1 level AAA for the given text size. */
  passesAAA: boolean;
}

const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Parses a hex color string (`#rgb`, `#rrggbb`, with or without the leading
 * `#`) into 0–255 sRGB channel values. Throws on any other input.
 */
export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const match = HEX_COLOR_PATTERN.exec(hex.trim());
  if (!match) {
    throw new Error(`Invalid hex color: "${hex}"`);
  }

  const value = match[1] ?? "";
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;

  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

function channelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

/** Relative luminance per WCAG 2.x, for a hex color string. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex);
  const rl = channelToLinear(r);
  const gl = channelToLinear(g);
  const bl = channelToLinear(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** Raw WCAG contrast ratio (1–21) between two hex colors, order-independent. */
export function contrastRatio(colorA: string, colorB: string): number {
  const luminanceA = relativeLuminance(colorA);
  const luminanceB = relativeLuminance(colorB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Validates the contrast ratio between a foreground and background color
 * against WCAG 2.1 AA/AAA thresholds.
 *
 * @param foreground hex color (e.g. text color)
 * @param background hex color
 * @param textSize "normal" (default) uses the stricter 4.5:1 / 7:1 thresholds;
 *   "large" (≥18pt / ≥14pt bold) uses the relaxed 3:1 / 4.5:1 thresholds.
 */
export function validateContrastRatio(
  foreground: string,
  background: string,
  textSize: ContrastTextSize = "normal",
): ContrastResult {
  const ratio = Math.round(contrastRatio(foreground, background) * 100) / 100;

  const aaThreshold = textSize === "large" ? 3 : 4.5;
  const aaaThreshold = textSize === "large" ? 4.5 : 7;

  return {
    ratio,
    passesAA: ratio >= aaThreshold,
    passesAAA: ratio >= aaaThreshold,
  };
}
