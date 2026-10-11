# Landing page assets

The marketing landing page (`apps/web/src/app/page.tsx`, issue #196) shows
product screenshots from `apps/web/public/landing/`. Files are named by role, so
swapping an asset later means replacing the file with the same name (phone and feature files are exported at 2x for sharpness, the img tags carry the CSS size)
(keep width/height, because the `<img>` tags carry fixed dimensions to avoid
layout shift). Plain `<img>` is used on purpose (Cloudflare Workers deployment,
no `next/image`).

| Role file (`public/landing/`) | Size (px) | Current source (`docs/landing-shots/`) | Used in                          |
| ----------------------------- | --------- | -------------------------------------- | -------------------------------- |
| `hero-phone-menu.webp`        | 390x844   | `menu.png` (top crop)                  | Hero, center phone               |
| `hero-phone-cart.webp`        | 390x844   | `cart.png` (top crop)                  | Hero, left phone                 |
| `hero-phone-status.webp`      | 390x844   | `status.png` (top crop)                | Hero, right phone                |
| `showcase-dashboard.webp`     | 1280x800  | `dashboard.png`                        | Showcase, large dashboard mockup |
| `showcase-analytics.webp`     | 640x400   | `analytics.png`                        | Showcase, floating holo card     |
| `feature-menu.webp`           | 390x520   | `menu.png` (crop)                      | Feature "Speisekarte"            |
| `feature-orders.webp`         | 390x520   | `dashboard.png` (left crop)            | Feature "Bestellung"             |
| `feature-checkout.webp`       | 390x520   | `checkout.png` (top crop)              | Feature "Zahlung"                |
| `feature-analytics.webp`      | 390x520   | `analytics.png` (center crop)          | Feature "Auswertung"             |

Notes:

- WebP, quality about 80, generated with `sharp` from the clean demo screenshots in `docs/landing-shots/` (demo photos from Unsplash, neutral demo names; the cancelled-orders column of the dashboard is hidden in the screenshot only).
- Do not use a checkout crop that shows payment-method names the product does
  not offer (the current `feature-checkout.webp` is cropped above them).
- Alt texts and the file list live in `apps/web/src/app/_landing/content.ts`
  (features) and `apps/web/src/app/page.tsx` (hero and showcase).

## Style building blocks

- Colors: design tokens only. Gradient/glow helper variables are `--lp-*` in
  `apps/web/src/app/globals.css` (light and dark variants), built from the
  existing palette with `color-mix`.
- Effects live in `apps/web/src/app/landing.css`: `.lp-glow` (blurred colour
  glows), `.lp-holo` / `.lp-holo-ring` (animated conic-gradient holographic
  border using `@property --lp-angle`, sheen and pointer glare), `.lp-glass`,
  `.lp-text-gradient`, `.lp-btn-glow`, `.lp-phone`/`.lp-float`.
- Only `HoloCard` (`_landing/holo-card.tsx`) is a client component; it just
  writes `--lp-mx`/`--lp-my` on pointer move.
- All motion is inside `@media (prefers-reduced-motion: no-preference)`; the
  fallback is the static gradient.
- Contrast is verified in `apps/web/src/app/page.a11y.test.ts` against the
  worst-case glow/gradient stops in both schemes.
- The product name is the `BRAND_NAME` constant in `_landing/content.ts`.
