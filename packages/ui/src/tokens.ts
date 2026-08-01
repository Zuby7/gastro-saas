/**
 * Minimal design-token set for gastro-saas.
 *
 * Source of truth for shared colors, spacing, and typography. Consumed by
 * `apps/web` as a Tailwind v4 theme extension (see `theme.css`, which must be
 * kept in sync with this file) and directly by any TS/React code that needs
 * token values outside of class names (e.g. contrast validation for
 * tenant-branding inputs).
 */

export const colors = {
  brand: {
    50: "#f2f8f6",
    100: "#dcece5",
    200: "#b9d9cb",
    300: "#8fc0ab",
    400: "#5fa287",
    500: "#3d8268",
    600: "#2c6753",
    700: "#245244",
    800: "#1f4237",
    900: "#1a372e",
  },
  neutral: {
    0: "#ffffff",
    50: "#f7f7f6",
    100: "#e7e6e4",
    200: "#d1cfcb",
    300: "#a9a6a0",
    400: "#7d7972",
    500: "#5c5952",
    600: "#45423d",
    700: "#332f2b",
    800: "#211f1c",
    900: "#141311",
  },
  danger: {
    500: "#c0362c",
    600: "#9c2c24",
  },
  success: {
    500: "#2f7d4f",
    600: "#256440",
  },
  warning: {
    500: "#b8791a",
    600: "#966215",
  },
} as const;

export const spacing = {
  0: "0px",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
  24: "6rem",
} as const;

export const typography = {
  fontFamily: {
    sans: "var(--font-sans, system-ui, sans-serif)",
    mono: "var(--font-mono, ui-monospace, monospace)",
  },
  fontSize: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.125rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
    "3xl": "1.875rem",
    "4xl": "2.25rem",
  },
  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
} as const;

export const tokens = { colors, spacing, typography } as const;

export type Tokens = typeof tokens;
