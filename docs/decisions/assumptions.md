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

## Explicitly not decided yet (needs the user or a later ticket)

- Real Stripe/Supabase/Resend/Sentry/PostHog/Better Stack account creation — these need the user's own email/identity and, for Stripe, banking details for payouts.
- Production domain purchase.
- Whether to use a full `packages/*` monorepo layout or a single-app structure — deferred to the first scaffolding ticket (Epic 1) per `docs/architecture/domain-boundaries.md`.
- Whether Prisma or the raw Supabase client is the typed data-access layer — deferred to the first database ticket.
- Production Stripe activation — requires explicit human approval per the source brief, not assumed here or ever without asking.
