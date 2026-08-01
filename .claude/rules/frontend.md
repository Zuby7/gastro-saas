---
description: Frontend rules — Next.js app, admin UI, public menu
paths: ["apps/web/**", "packages/ui/**"]
---

- Public menu pages are server-rendered for performance/SEO; admin pages may be client-heavy where interactivity needs it.
- Use the shared design-token system in `packages/ui` — no ad-hoc hex colors or one-off spacing values.
- Accessibility is not optional: keyboard navigation, visible focus, semantic headings, labeled form fields, screen-reader-friendly error messages, sufficient contrast, no color-only signaling. Add automated a11y checks to any new Playwright flow that touches menu browsing, cart, checkout, or admin menu editing.
- Never trust client-side price/total calculations for anything shown at checkout — display the server-recalculated values.
- Draft vs. published menu state must be visually unambiguous in the admin UI.
- Tenant branding customization must never be allowed to break accessibility (e.g. contrast) — validate branding inputs against a minimum contrast ratio.
