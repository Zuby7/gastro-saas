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
- Design direction (per `docs/design/*` if present, and per the user's explicit request 2026-08-01 to avoid a generic/templated look): before building the public menu (Epic 5) or admin UI (Epic 4), use the `frontend-design` skill/plugin (github.com/anthropics/claude-code, `plugins/frontend-design`) if installed — it enforces a two-pass design-token-and-critique process aimed at avoiding templated "AI-generated" defaults. If not installed in this session, the user can add it via the Claude Code plugin marketplace (`anthropics/claude-code`) and install `frontend-design`.
