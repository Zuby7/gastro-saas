# Service Register

Discovery source: [free-for.dev](https://free-for.dev/#/). Every entry below was cross-checked against official/vendor-adjacent pricing pages via web search on **2026-08-01**. Third-party pricing summaries drift — before relying on an exact number in production, re-check the vendor's own pricing page.

Policy: one provider per capability, free tier only, until a documented requirement forces an upgrade. Two capabilities in this stack **cannot be genuinely free** — flagged explicitly below rather than silently worked around.

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
- Credit card: required only when the *tenant* completes Connect onboarding to receive real payouts, not for platform development.
- Decision: **Stripe Connect, test mode only**, until the user explicitly authorizes production activation.

## Transactional email — Resend
- Free plan: 3,000 emails/month, capped at 100/day, 1 verified domain, 30-day log retention. Permanent free tier (not a trial).
- Risk: the 100/day cap can be hit by password resets + order confirmations on a busy day for a single popular restaurant — worth monitoring once real order volume exists.
- Credit card: not required.
- Decision: **default** for order confirmations and staff invitations. Fallback: a second free-tier provider (e.g. Brevo, 300 emails/day free) only if Resend's daily cap becomes a real blocker — do not add both up front.

## Error monitoring — Sentry
- Free "Developer" plan: 5,000 errors/month, 1 user (single dashboard viewer), 30-day retention, 5 GB logs, 1 uptime monitor, 20 metric monitors.
- Single-user limitation matters once more than one person needs to triage — acceptable for the founding pass, revisit before adding a second engineer.
- Credit card: not required.
- Decision: **default**.

## Product analytics (of the SaaS app itself, not restaurant sales) — PostHog
- Free plan: 1M events/month, 5K session replays, 1M feature-flag requests, 1-year retention, unlimited team members.
- Reminder (master prompt §10, §14.1): PostHog is for understanding usage of the *gastro-saas application itself* — restaurant sales analytics must always be computed from the platform's own order/order-item tables, never from PostHog.
- Credit card: not required.
- Decision: **default**, disabled by default per tenant privacy settings until a lawful basis/consent flow is documented.

## DNS / CDN — Cloudflare
- Already selected for hosting; DNS and CDN are part of the same free plan (unlimited bandwidth, free SSL, free Turnstile for bot protection).
- Decision: **default**, one account covers hosting + DNS + CDN + bot protection.

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
