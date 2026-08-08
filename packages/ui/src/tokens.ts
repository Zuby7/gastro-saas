/**
 * Design-token set for gastro-saas.
 *
 * Source of truth for shared colors, spacing, and typography. Consumed by
 * `apps/web` as a Tailwind v4 theme extension (see `theme.css`, which must be
 * kept in sync with this file) and directly by any TS/React code that needs
 * token values outside of class names (e.g. contrast validation for
 * tenant-branding inputs).
 *
 * --- Design pass v2 (2026-08-08, frontend design overhaul) -----------------
 *
 * Why this pass exists: the previous pass (`clay` terracotta accent + warm
 * cream `neutral-50`/`neutral-100` + `Fraunces` soft-serif display face) is,
 * verbatim, one of the three generic "AI-generated design" default patterns
 * called out by Anthropic's own `frontend-design` skill: "warm cream
 * backgrounds with serif display + terracotta accents." Our old
 * `neutral-50` (#f8f3ea) was nearly the exact flagged hex (#F4F1EA). This
 * pass replaces every part of that combination -- not just the hex values,
 * the whole structural pattern -- and grounds the aesthetic in restaurant
 * ORDERING/SERVICE vernacular (kitchen tickets, receipts, order numbers,
 * table service) shared across cuisines, not one cuisine's iconography, since
 * the platform serves many kinds of restaurants, not just the Italian demo
 * tenant.
 *
 * ## Pass 1 -- Design Plan
 *
 * ### Color (5 named families + neutral)
 *  - `brand` (herb green, UNCHANGED) -- stays the only primary/interactive
 *    color (publish, save, submit, checkout CTA). It was never part of the
 *    cliché pattern and isn't being touched, so it can't collide with the
 *    `danger` semantic role the way pushing a new color into "primary" could.
 *  - `ember` (new, replaces `clay`) -- a saturated paprika/brick-red-orange,
 *    anchored at `#BE3D18` for the 500 step. Deliberately more vivid/"stamped"
 *    than the old muted terracotta (`clay-500` was `#b35f2e`, a dusty rust) --
 *    it should read like a kitchen-ticket ink stamp or a chili-pepper red,
 *    not a rustic clay pot. Used sparingly for the one signature moment (the
 *    order-ticket motif) and as the price/total accent, never as a large
 *    fill or a second competing primary-action color.
 *  - `gold` (new) -- a warm brass/mustard, anchored at `#9C721B`. Used only
 *    for small highlights (the ticket-stamp "seal", draft/warning badges) --
 *    never a large fill. `warning` is now a semantic alias onto this family
 *    (`warning-500`/`warning-600` == `gold-500`/`gold-600`) rather than an
 *    independent near-duplicate amber hue: warning badges (e.g. the admin
 *    menu editor's "Entwurf" pill) already read as "caution/attention", which
 *    is exactly gold's job, so keeping a second, barely-distinguishable amber
 *    around would just clutter the palette for no semantic gain.
 *  - `neutral` -- `0` (pure white) is untouched. `50`/`100` are replaced with
 *    a genuinely desaturated warm stone/gray (`#F7F5F2`/`#EDEAE4`) -- aged
 *    concrete or raw paper pulp, not stationery cream (no yellow/cream cast
 *    left in the ramp at all). `200`-`900` were already fairly desaturated
 *    warm grays in the previous pass (e.g. `200` was `#d1cfcb`) and don't
 *    read as "cream", so they're kept as-is to minimize unrelated churn and
 *    avoid re-breaking already-verified contrast pairs at those steps.
 *  - `danger` -- shifted from an orange-leaning red (`#c0362c`, close in hue
 *    to the new `ember`) to a crimson/magenta-leaning red (`#C21F4B`/
 *    `#9C1A3D`) specifically so an error state can never be visually confused
 *    with the ember accent -- they now sit on opposite sides of red on the
 *    hue wheel instead of being near-neighbors.
 *  - `success` -- left unchanged (`#2f7d4f`/`#256440`); it was never part of
 *    the cliché pattern and doesn't compete hue-wise with anything new.
 *  Every new/changed pair used for text has been checked against
 *  `validateContrastRatio` (see `packages/ui/src/contrast.test.ts` and the
 *  `*-design.a11y.test.ts` files under `apps/web/src/app/r/[slug]/**`)
 *  before use.
 *
 * ### Type (3 roles, deliberately re-paired)
 *  - Display/heading face: **Roboto Slab** (Google Font, `next/font/google`),
 *    replacing Fraunces. A slab serif's sturdy, rectangular, structural
 *    letterforms read like diner/menu-board signage and rubber-stamped
 *    ticket type -- the opposite of Fraunces' soft, editorial, "boutique
 *    cookbook" curves. This is the type half of the "not a re-skin" check:
 *    swapping only the color palette while keeping a soft serif would still
 *    read as the same design, just repainted.
 *  - Body face: **Geist Sans** (unchanged) -- already legible and wired
 *    app-wide; replacing a working body face for novelty isn't the ticket.
 *  - Utility/ticket face: **Space Mono** (new, replaces the previously-unused
 *    Geist Mono registration) -- used ONLY where a number is literally
 *    ticket/receipt data: order numbers, status codes, the stamped badge on
 *    the order-status page. This is "structure encodes information": mono
 *    spacing belongs specifically where digits represent a real fixed-width
 *    ticket/order token, not decoratively on running prose.
 *
 * ### Layout (ASCII wireframes for the key screens)
 *
 * Public menu hero (`/r/[slug]`):
 * ```
 * +--------------------------------------------------+
 * | Trattoria Bella                     [Warenkorb 2]|  <- Roboto Slab h1
 * | Familiengeführtes Restaurant seit 1998            |
 * +--------------------------------------------------+
 * | [Vorspeisen] [Hauptgerichte] [Desserts]           |  <- sticky category nav
 * +--------------------------------------------------+
 * |  Category heading (Roboto Slab)                   |
 * |  +-------------+  +-------------+                 |
 * |  | dish card   |  | dish card   |   ember price    |
 * |  +-------------+  +-------------+                 |
 * ```
 * No hero rule/underline gimmick this time (that was still a decorative
 * flourish, not functionally motivated) -- the hero's "thesis" is the
 * restaurant name in the new structural display face, full stop.
 *
 * Cart, with the ticket motif (`/r/[slug]/cart`):
 * ```
 * +--------------------------------------------------+
 * | Warenkorb                      [Zur Speisekarte]  |
 * +--------------------------------------------------+
 * | line item ................................  6,50€ |
 * | line item ................................  9,00€ |
 * +----------------------- ticket card ---------------+
 * | Gesamtsumme                        15,50€ (ember)  |
 * VvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVv  <- torn/perforated
 * +--------------------------------------------------+  bottom edge
 * |              [ Zur Kasse ]                        |
 * +--------------------------------------------------+
 * ```
 *
 * Order status, the full ticket-card treatment (`/r/[slug]/orders/[token]`):
 * ```
 * +----------------- ticket card ---------------------+
 * | BESTELLUNG                      #A1B2C3D4 (mono,   |
 * | Aktueller Status                  gold stamp badge)|
 * | IN ZUBEREITUNG  (ember, Roboto Slab)               |
 * VvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVvVv
 * +--------------------------------------------------+
 * | Details / Bestellte Artikel / Verlauf (quiet,      |
 * | unchanged neutral cards -- the ticket is the ONE   |
 * | signature moment on this page, not every card)     |
 * +--------------------------------------------------+
 * ```
 *
 * ### Signature element
 * A kitchen-order-ticket / paper-receipt card: a subtly torn/perforated
 * bottom edge (CSS `clip-path`, no image asset -- see `.ticket-edge` in
 * `apps/web/src/app/globals.css`), used ONLY where the content genuinely IS
 * the customer's order (cart summary, checkout's pre-submit order summary,
 * and the order-status page's live-status card) -- never decoratively
 * elsewhere. Order identifiers render in Space Mono inside a small
 * gold-bordered "stamp" badge, reinforcing the same ticket metaphor.
 *
 * ## Pass 2 -- Critique
 *  - Cliché #1 (warm cream + serif + terracotta): explicitly not this --
 *    neutrals are desaturated stone (no cream cast), the accent is a vivid
 *    stamped ember-red (not dusty terracotta), and the display face is a
 *    structural slab serif (not a soft editorial serif).
 *  - Cliché #2 (near-black bg + acid-green/vermilion): not this -- surfaces
 *    stay light (`neutral-0`/`neutral-50`), `brand` green is desaturated and
 *    used only for actions, `ember` red-orange is warm/stamped rather than
 *    a cold neon vermilion.
 *  - Cliché #3 (broadsheet, hairline rules, no radius, dense columns): not
 *    this -- cards keep rounded-lg corners and shadow-sm depth throughout;
 *    the one place the geometry gets deliberately irregular (the ticket
 *    edge) is a functional, order-specific motif, not a general layout
 *    system.
 *  - "Would I produce this for any similar project?": no -- the ticket/
 *    receipt motif is specific to an ordering/fulfillment product (it would
 *    be wrong for, say, a hotel booking or a SaaS dashboard), and it's
 *    cuisine-agnostic (chits/receipts/order numbers exist identically for a
 *    burger counter, a sushi bar, or a trattoria), unlike the previous
 *    pass's "chalkboard menu" framing which leaned generically Italian-bistro.
 *  - "Not just a re-skin with the same structure": both type roles changed
 *    (slab serif instead of soft serif, new dedicated mono role instead of
 *    an unused registration), the neutral ramp lost its cream cast rather
 *    than just shifting hue, and the hero's decorative underline rule was
 *    removed rather than recolored -- the hero's "moment" is now the type
 *    treatment itself, not a color flourish under it.
 *  - Self-critique ("remove one accessory"): the public menu hero originally
 *    kept a colored rule under the restaurant name in an earlier draft of
 *    this pass; it was removed so the ticket-edge motif on cart/checkout/
 *    order-status remains the ONE bold moment, with the menu hero staying
 *    quiet (structural type only, no added ornament).
 *  - Admin UI deliberately gets ONLY the color/type token swap, no
 *    ticket-edge/perforated treatment anywhere -- it should read as a
 *    considered professional tool, not the customer-facing "moment" surface.
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
  ember: {
    50: "#fdeee8",
    100: "#fad6c5",
    200: "#f3ad8c",
    300: "#e97f54",
    400: "#d65a2e",
    500: "#be3d18",
    600: "#9c3113",
    700: "#7a260f",
    800: "#591b0a",
    900: "#3b1207",
  },
  gold: {
    50: "#faf3e1",
    100: "#f1dfaf",
    200: "#e3c077",
    300: "#d0a24c",
    400: "#b4872e",
    500: "#9c721b",
    600: "#7d5b15",
    700: "#614611",
    800: "#45320c",
    900: "#2d2007",
  },
  neutral: {
    0: "#ffffff",
    50: "#f7f5f2",
    100: "#edeae4",
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
    500: "#c21f4b",
    600: "#9c1a3d",
  },
  success: {
    500: "#2f7d4f",
    600: "#256440",
  },
  // Alias onto `gold` -- see the "Color" section of the header comment for
  // why `warning` doesn't get its own independent hue.
  warning: {
    500: "#9c721b",
    600: "#7d5b15",
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
