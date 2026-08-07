/**
 * Design-token set for gastro-saas.
 *
 * Source of truth for shared colors, spacing, and typography. Consumed by
 * `apps/web` as a Tailwind v4 theme extension (see `theme.css`, which must be
 * kept in sync with this file) and directly by any TS/React code that needs
 * token values outside of class names (e.g. contrast validation for
 * tenant-branding inputs).
 *
 * --- Design pass (2026-08-07, frontend-design polish, Epic 4/5) -----------
 *
 * Goal: move away from a generic "tech SaaS" look toward something grounded
 * in hospitality — warm, appetite-appealing, tactile. Plan (written before
 * implementing, per `frontend-design` skill guidance):
 *
 * Colors (6 named families):
 *  - `brand` (herb green) — kept from the original palette, it already reads
 *    as "fresh/organic" rather than generic teal. Used for primary actions
 *    (publish, save, submit) across admin + public menu.
 *  - `clay` (new — burnt terracotta/rust) — the one new accent family. Used
 *    sparingly and deliberately for the public menu's signature moment (see
 *    below), never for primary buttons, so it stays a distinctive accent
 *    rather than a second competing "brand" color.
 *  - `neutral` — kept the existing warm (not blue-gray) neutral ramp, but
 *    retuned the lightest two steps (`50`/`100`) toward a warm paper/cream
 *    tone instead of a near-white technical gray, so page backgrounds read
 *    as "menu card stock" rather than "app chrome". `0` (pure white) is
 *    untouched so existing card/table surfaces and contrast tests are
 *    unaffected.
 *  - `danger` / `success` / `warning` — kept as-is; already warm-toned and
 *    already pass AA, no reason to touch semantic colors in a visual pass.
 *  Every new/changed pair used for text has been checked against
 *  `validateContrastRatio` (see `packages/ui/src/contrast.test.ts` and
 *  `apps/web/src/app/page.a11y.test.ts`) before use.
 *
 * Typography (2 roles):
 *  - Display/heading face: **Fraunces** (Google Font, via `next/font/google`)
 *    — a soft-serif with real character (variable optical size, slight
 *    warmth), reads as "considered restaurant branding" rather than a
 *    generic UI face. Used for the public-menu hero (restaurant name),
 *    category headings, and (lightly, for hierarchy only) admin page `h1`s.
 *  - Body face: kept the already-established **Geist Sans** (`next/font/
 *    google` via `apps/web/src/app/layout.tsx`) — highly readable, already
 *    wired up app-wide; no reason to replace a working, legible body face
 *    just for novelty.
 *
 * Signature element (public menu only, the one deliberately memorable
 * moment — everything else stays quiet/disciplined):
 *  - The restaurant-name hero: large `Fraunces` heading with a short,
 *    hand-drawn-feeling `clay`-colored rule underneath it, on the new warm
 *    paper background. Category headings reuse the same display face at a
 *    smaller size for a coherent typographic system, but are NOT a second
 *    "moment" — no extra color, texture, or ornament there beyond the
 *    consistent type treatment, so the hero remains the one focal point.
 *
 * Self-critique: a green/terracotta palette + serif display type + a warm
 * paper background is specific to food/hospitality branding (chalkboard
 * menus, quality paper stock) and would look out of place on a generic
 * dashboard/SaaS product — it doesn't reduce to "just add a serif font",
 * because the palette, background warmth, and hero treatment reinforce each
 * other. Admin UI intentionally does NOT get the hero/rule treatment or the
 * `clay` accent — it stays functional-but-considered per the ticket.
 * ---------------------------------------------------------------------------
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
  clay: {
    50: "#fbf1ea",
    100: "#f5ddc9",
    200: "#eabf98",
    300: "#dc9a67",
    400: "#c97a43",
    500: "#b35f2e",
    600: "#954a22",
    700: "#7a3c1e",
    800: "#5e2f19",
    900: "#4a2615",
  },
  neutral: {
    0: "#ffffff",
    50: "#f8f3ea",
    100: "#efe6d5",
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
    display: "var(--font-display, ui-serif, Georgia, serif)",
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
