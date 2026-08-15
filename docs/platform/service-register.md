# Service Register

Discovery source: [free-for.dev](https://free-for.dev/#/). Every entry below was cross-checked against official/vendor-adjacent pricing pages via web search on **2026-08-01**. Third-party pricing summaries drift — before relying on an exact number in production, re-check the vendor's own pricing page.

Policy: one provider per capability, free tier only, until a documented requirement forces an upgrade. Two capabilities in this stack **cannot be genuinely free** — flagged explicitly below rather than silently worked around.

## License policy for code dependencies

Per explicit user instruction (2026-08-01): every library/framework in the codebase must be free, open source, and permissively licensed for commercial resale — no paid licenses, no copyleft license (GPL/AGPL) that would force this proprietary codebase to be open-sourced. Every stack choice in ADR-0001 satisfies this: Next.js/React (MIT), TypeScript (Apache 2.0), Tailwind CSS (MIT), Zod (MIT), Vitest (MIT), Playwright (Apache 2.0), the Supabase client libraries (MIT/Apache 2.0), and the Stripe SDK (MIT) are all permissive. Any new dependency added in a future ticket must be checked against this rule before it's added — flag it in that ticket's PR if unsure, don't assume.

**One unavoidable exception, called out explicitly rather than hidden**: real card payment processing always carries a per-transaction fee (Stripe: 2.9% + 30¢, see below) — this is not a software license cost, it's the cost of moving real money through a card network, and no provider (Stripe or any competitor) processes real payments for free. Stripe **test mode**, which the entire MVP runs in, is completely free. Production activation — and therefore the point where real fees start — requires the user's explicit approval, per `.claude/rules/payments.md`.

## Source control, issues, CI — GitHub

- Free plan: unlimited public/private repos, Issues, Projects (beta boards).
- Actions (private repos): 2,000 Linux-equivalent minutes/month, 500 MB artifact storage. Windows minutes cost 2x, macOS 10x against the quota. Public repos: unlimited Actions minutes.
- Spending limit defaults to $0 — jobs stop rather than incur surprise charges.
- Credit card: not required for the Free plan.
- Suitable for: MVP development and small-scale CI. Fallback if minutes run out: split workflows, cache aggressively, or move to a public repo (not viable here — tenant/customer code stays private).
- Decision: **default**, no viable free alternative needed.

## Hosting — Cloudflare Pages/Workers (chosen over Vercel)

- Vercel Hobby: 100 GB data transfer, 1M edge requests, 1M function invocations/month, 6,000 build minutes, up to 200 projects — **but the Hobby ToS explicitly restrict it to personal, non-commercial use; a project that takes payments or serves paying customers requires Pro ($20/seat/month)**. That disqualifies it as the default for a commercial gastronomy SaaS.
- Cloudflare Pages/Workers Free: unlimited bandwidth/requests for static assets, 100,000 Workers requests/day, 500 builds/month, 20,000 files/site, 3 MiB Worker size — and, unlike Vercel Hobby, **commercial use is allowed on the free plan**.
- Next.js runs on Cloudflare via the community `@opennextjs/cloudflare` adapter (Node.js runtime support, not just Edge). This is a real constraint versus Vercel's native Next.js support — some very new Next.js features may lag in adapter support.
- Credit card: not required to sign up; required only if usage-based Workers Paid is later enabled.
- Decision: **Cloudflare Pages/Workers** for hosting, `*.pages.dev` free subdomain until a real domain is purchased. Documented deviation from the master prompt's Vercel-first default — reason: the free-only, must-support-commercial-use constraint the user set for this project.
- Fallback: Vercel Hobby for pure internal previews/demos that never touch real payments.

## Database, auth, storage — Supabase

- Free plan: 2 active projects (pause after 1 week idle), 500 MB DB storage, 1 GB file storage, 5 GB egress, 50,000 MAUs, 200 concurrent Realtime connections, 500,000 Edge Function invocations/month, unlimited API requests, Row Level Security available on all tiers (core Postgres feature, not gated).
- Not included on Free: backups, SLA, SSO/SAML, leaked-password protection, custom-branding on auth emails.
- Credit card: not required.
- Suitable for: MVP and small pilot (well under 500 MB / 50k MAU for a single early-stage restaurant tenant set).
- Decision: **default**. Fallback if a tenant's data outgrows 500 MB: upgrade that one Supabase project to Pro ($25/mo) rather than re-platforming.

## Payments — Stripe + Stripe Connect

- **This is the one category that cannot be free in production.** Standard card processing: 2.9% + 30¢ per transaction (US rates; EU rates are broadly similar, verify for the tenant's country). No monthly/setup fee on the base plan.
- Stripe Connect: no platform monthly fee if Stripe bills connected accounts directly (the "Stripe-billed" model) — recommended for this platform. A "platform-billed" model exists but adds ~$2/month + per-payout fees; not needed initially.
- Test mode (sandbox) is fully free — required for the entire MVP build per the master prompt (§8.5) until the user explicitly flips to live keys.
- Credit card: required only when the _tenant_ completes Connect onboarding to receive real payouts, not for platform development.
- Decision: **Stripe Connect, test mode only**, until the user explicitly authorizes production activation.

## Transactional email — Resend

- Free plan: 3,000 emails/month, capped at 100/day, 1 verified domain, 30-day log retention. Permanent free tier (not a trial).
- Risk: the 100/day cap can be hit by password resets + order confirmations on a busy day for a single popular restaurant — worth monitoring once real order volume exists. Ticket #40 (order confirmation emails) surfaces a hit daily limit as a visible, logged/recorded failure (structured `console.error` plus an `email_sends` row, since `@sentry/nextjs` is not actually wired into the codebase yet despite being this project's designated error monitor below) rather than a silently-lost email — see `apps/web/src/lib/notifications/order-confirmation-email.ts`.
- Credit card: not required.
- Decision: **default** for order confirmations and staff invitations. Fallback: a second free-tier provider (e.g. Brevo, 300 emails/day free) only if Resend's daily cap becomes a real blocker — do not add both up front.

## Error monitoring — Sentry

- Free "Developer" plan: 5,000 errors/month, 1 user (single dashboard viewer), 30-day retention, 5 GB logs, 1 uptime monitor, 20 metric monitors.
- Single-user limitation matters once more than one person needs to triage — acceptable for the founding pass, revisit before adding a second engineer.
- Credit card: not required.
- Decision: **default**.

## Product analytics (of the SaaS app itself, not restaurant sales) — PostHog

- Free plan: 1M events/month, 5K session replays, 1M feature-flag requests, 1-year retention, unlimited team members.
- Reminder (master prompt §10, §14.1): PostHog is for understanding usage of the _gastro-saas application itself_ — restaurant sales analytics must always be computed from the platform's own order/order-item tables, never from PostHog.
- Credit card: not required.
- Decision: **default**, disabled by default per tenant privacy settings until a lawful basis/consent flow is documented.

## DNS / CDN — Cloudflare

- Already selected for hosting; DNS and CDN are part of the same free plan (unlimited bandwidth, free SSL, free Turnstile for bot protection).
- Decision: **default**, one account covers hosting + DNS + CDN + bot protection.

## Database backups — Cloudflare R2 (free tier)

- Free tier: 10 GB storage, no egress fees (unlike S3). Used only as the target for the scheduled `pg_dump` backup job described in `docs/operations/deployment-strategy.md` — resolves the contradiction the Opus architecture review flagged (release checklist required backups; Supabase Free has none).
- Credit card: required to create a Cloudflare account with R2 enabled, but no charge occurs within the free storage/egress limits.
- Decision: **default**, same Cloudflare account already used for hosting/DNS/CDN.

## Uptime monitoring — Better Stack (chosen over UptimeRobot)

- UptimeRobot free plan, as of December 2024, restricts free-tier use to personal/non-commercial projects — explicitly prohibits commercial/business/client use. Disqualified for the same reason as Vercel Hobby.
- Better Stack free plan: 10 monitors/heartbeats, 1 status page, Slack/email alerts, 3 GB logs (3-day retention) — no commercial-use restriction found in its terms as of this check (unlike UptimeRobot's explicit ban), but this should be re-confirmed against Better Stack's current ToS before relying on it long-term.
- Credit card: not required.
- Decision: **Better Stack**, with a documented fallback of a simple GitHub Actions cron hitting the public health endpoint if ToS terms change.

## Domains

- No free registrar for a real custom domain exists — flagged explicitly per the user's request rather than silently substituted.
- For now: use the free `*.pages.dev` subdomain (Cloudflare) for every environment, including the eventual pilot tenant. Per-tenant subdomains (`<tenant>.gastro-saas.pages.dev`-style or a wildcard on a later purchased domain) are supported by the architecture from day one.
- Buying a real domain (`~10–15 €/year` for a `.de`/`.com`) is a deliberate, explicit-approval step for later — not part of this pass (§14.2, §26).

## Feature flags

- No dedicated service added. A `tenant_feature_flags` table (per §14.1: "a simple database-backed tenant feature configuration may be sufficient") covers MVP needs. Revisit only if flag targeting rules become too complex for SQL.

## Explicitly not added

- Jira / Linear (GitHub Issues + Projects is sufficient per the user's explicit choice).
- A dedicated image-transformation service (Supabase Storage + Next.js/Cloudflare image resizing is sufficient at MVP scale).
- A queue system (Redis/SQS-style) — none of the MVP background jobs (email send, webhook processing, scheduled availability) need one yet; revisit only when volume demands it (§13.4).

## Re-verification reminder

Every "Decision" above should be re-checked against the vendor's own pricing page immediately before the first production deploy — free-tier terms (especially commercial-use restrictions) have changed at least twice across these vendors within the last 18 months (Vercel Hobby, UptimeRobot) and can change again without notice.
