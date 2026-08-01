# Assumptions Log

Decisions made autonomously because they were low-risk, reversible, and didn't require credentials, payment, or legal acceptance. Anything not listed here that materially affects direction should be raised with the user, not assumed.

## Tooling / environment

- **pnpm install path**: Corepack's `prepare pnpm@latest --activate` failed on this machine (EPERM writing to `C:\Program Files\nodejs\yarn`, plus a corepack signing-key verification error — a known corepack issue, not specific to this repo). Installed pnpm instead via `npm install -g pnpm` (global npm prefix `C:\Users\Zaby\AppData\Roaming\npm`). This directory is not yet on the default PATH for every shell — commands that need `pnpm` should reference it explicitly or the user should add `%APPDATA%\npm` to their permanent PATH. Reversible, no admin rights used.
- **GitHub CLI install**: no package manager (winget/choco/scoop) was available on this machine. Installed `gh` v2.97.0 by downloading the official Windows zip release from `github.com/cli/cli/releases` and placing `gh.exe` in `C:\Users\Zaby\bin` (already on PATH). No admin rights used, no system files touched.
- **Git identity**: already configured on this machine (`Zuhaib Ahmad <z.ahmad@smf.de>`) — used as-is for the initial commit.

## Product/architecture

- **Hosting**: Cloudflare Pages/Workers instead of the source brief's default suggestion of Vercel, because Vercel's free Hobby tier explicitly prohibits commercial use and the user asked for a fully free setup for a real commercial product. See `docs/platform/service-register.md`.
- **Uptime monitoring**: Better Stack instead of UptimeRobot, for the same reason (UptimeRobot's free tier banned commercial use in Dec 2024).
- **GitHub tickets language**: ticket titles and descriptions are written in German per the user's explicit instruction, overriding the source brief's general "docs in English" default for this one artifact type. All other documentation, code, and identifiers remain in English.
- **Repository name/visibility**: `gastro-saas`, private — confirmed with the user directly (not assumed).
- **Package manager for the eventual app code**: pnpm, per the source brief's own stack default.

## User-directed decisions (explicit instructions, not autonomous assumptions)

- **Merge policy** (2026-08-01, after the auto-mode classifier correctly blocked a self-authored-self-merged PR; reconfirmed 2026-08-01 after Opus validation cadence reverted to per-ticket): every PR, regardless of risk label, requires an explicit human merge decision — never automatic, never self-merged by the same agent without that gate. This subsumes the earlier risk-labelled-only rule now that there's no epic-batch gate to auto-trigger off. See `.claude/skills/ship-ticket/SKILL.md`. Ticket #1's PR (#42) was merged before this policy was confirmed; it stands, but no further PR merges happen without it.

- **Opus validation cadence** (2026-08-01, revised same day): the user first changed the default from per-ticket Opus validation to end-of-epic batch validation, to avoid reviewing "every line of code" at high cost. After Epic 1's batch review (`artifacts/reviews/epic-1.json`) and ticket #4's per-ticket review (`artifacts/reviews/issue-4.json`) both surfaced real, non-trivial findings — including a genuine cross-tenant RLS bypass in #4 that a risk-label-only gate would have caught, but which validated the value of the tighter signal — the user reverted the cadence back to **per-ticket, always, every ticket, regardless of risk label**, accepting the extra Opus cost. `opus-validator` runs on Opus 5 (`model: opus`, the current frontier Opus, not a pinned older version). See `CLAUDE.md` and `.claude/skills/ship-ticket/SKILL.md` / `.claude/skills/validate-ticket/SKILL.md`. The end-of-epic batch mode remains documented in `/validate-ticket` only as a fallback, not the active default.
- **License policy**: every code dependency must be free, open source, and permissively licensed for commercial resale (MIT/Apache 2.0/BSD-style) — no paid licenses, no copyleft (GPL/AGPL). See `docs/platform/service-register.md`. The one unavoidable exception is Stripe's real-money transaction fee (2.9% + 30¢), which is a payment-processing cost, not a software license cost, and only applies once the user explicitly activates production payments — everything in the MVP build itself runs on free tools and Stripe test mode.
- **Repository name/visibility**: `gastro-saas`, private — confirmed with the user directly.
- **GitHub tickets language**: German titles/descriptions, per explicit instruction.
- **MFA for Owner/Manager**: not built in this foundation pass (accepted risk, tracked in `docs/security/threat-model.md`) — flagged by the Opus architecture review as a gap for accounts that control Stripe payouts/refunds. Should become a real ticket before a pilot tenant's Stripe account goes live with real payouts, not indefinitely deferred.

## Opus architecture review (2026-08-01) — what was fixed vs. deferred

The pre-implementation Opus review (`artifacts/reviews/architecture-review-pass-1.json`) returned `CHANGES_REQUESTED` with 12 findings. Fixed in this pass: the guest/unauthenticated-path tenant-isolation gap (critical — added "Layer 0" to `docs/security/tenant-isolation.md` and `.claude/rules/tenant-isolation.md`), the missing tax/VAT model (added to `docs/data/domain-model.md`), the undefined Stripe Connect account/charge topology (`docs/architecture/adr/0002-stripe-connect-account-model.md`), the backups-vs-free-tier contradiction (Cloudflare R2 backup job added to `docs/operations/deployment-strategy.md` and the service register), and the amount-mismatch/`awaiting_payment`-expiry gaps in `.claude/rules/payments.md`.

Deferred to ticket-level fixes (tracked as follow-up, not yet done): correcting ticket #4's "exactly one Owner" wording to "at least one Owner", adding a transactional-email ticket (order confirmation via Resend — currently only invitations are covered), adding an MVP-phase imprint/privacy/consent ticket (currently only a post-MVP retention/export ticket exists), re-sequencing the cross-tenant-harness ticket (#5) to not depend on auth (#7), moving `analytics_events` table creation earlier than ticket #31, seeding `packages/ui` design tokens in ticket #1, and marking ticket #39 (integration reconciliation) as blocked on a real integration partner rather than freely schedulable. These should be applied to the GitHub Issues before Epic 3/4/6/7/12 work starts, respectively.

## Tracked follow-up: `.env.example` key reconciliation (from ticket #3's PR, not yet done)

`.env.example`'s Supabase demo values were filled in from the well-known local-dev defaults documented by Supabase (not a real `supabase status -o env` run), because local Docker/Supabase could not be smoke-verified on this dev machine (disk space / Docker availability — see the CI-only reliance noted in `docs/operations/deployment-strategy.md` and `.github/workflows/migration-check.yml`). Outstanding, not yet done:

- Once local Docker/Supabase works on a dev machine, run `supabase start` + `supabase status -o env` and diff the real output against `.env.example` to confirm no drift.
- Current Supabase CLI versions (2.x) emit a newer publishable/secret key format (`sb_publishable_...` / `sb_secret_...`) alongside/instead of the older JWT-style anon/service-role keys. `.env.example` and any onboarding docs should document both formats and which one a given CLI version produces, so a developer isn't confused when their locally generated keys don't look like the checked-in example.

This was previously only recorded in the (merged) PR #44 description; it is tracked here so it isn't lost.

## Explicitly not decided yet (needs the user or a later ticket)

- Real Stripe/Supabase/Resend/Sentry/PostHog/Better Stack account creation — these need the user's own email/identity and, for Stripe, banking details for payouts.
- Production domain purchase.
- Whether to use a full `packages/*` monorepo layout or a single-app structure — deferred to the first scaffolding ticket (Epic 1) per `docs/architecture/domain-boundaries.md`.
- Whether Prisma or the raw Supabase client is the typed data-access layer — deferred to the first database ticket.
- Production Stripe activation — requires explicit human approval per the source brief, not assumed here or ever without asking.
