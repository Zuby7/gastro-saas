# Landing page assets

The marketing landing page (`apps/web/src/app/page.tsx`, issue #196) shows
product screenshots from `apps/web/public/landing/`. Files are named by role, so
swapping an asset later means replacing the file with the same name and size
(keep width/height, because the `<img>` tags carry fixed dimensions to avoid
layout shift). Plain `<img>` is used on purpose (Cloudflare Workers deployment,
no `next/image`).

| Role file (`public/landing/`) | Size (px) | Current source (`docs/onboarding/img/`) | Used in                          |
| ----------------------------- | --------- | --------------------------------------- | -------------------------------- |
| `hero-phone-menu.webp`        | 390x844   | `21-gast-speisekarte.png` (top crop)    | Hero, center phone               |
| `hero-phone-cart.webp`        | 390x844   | `22-gast-warenkorb.png` (top crop)      | Hero, left phone                 |
| `hero-phone-status.webp`      | 390x844   | `24-gast-bestellstatus.png` (top crop)  | Hero, right phone                |
| `showcase-dashboard.webp`     | 1280x800  | `03-bestellungen.png`                   | Showcase, large dashboard mockup |
| `showcase-analytics.webp`     | 640x400   | `05-analytics.png`                      | Showcase, floating holo card     |
| `feature-menu.webp`           | 390x520   | `21-gast-speisekarte.png` (crop)        | Feature "Speisekarte"            |
| `feature-orders.webp`         | 390x520   | `03-bestellungen.png` (left crop)       | Feature "Bestellung"             |
| `feature-checkout.webp`       | 390x520   | `23-gast-kasse.png` (top crop)          | Feature "Zahlung"                |
| `feature-analytics.webp`      | 390x520   | `05-analytics.png` (center crop)        | Feature "Auswertung"             |

Notes:

- WebP, quality about 80, generated with `sharp`. Cleaner screenshots from
  `docs/landing-shots/` can replace these later; re-export to the same sizes.
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
