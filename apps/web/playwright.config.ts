import { defineConfig } from "@playwright/test";

/**
 * Minimal Playwright setup for ticket #7's required login E2E test. This is
 * deliberately NOT a full E2E framework buildout (docs/testing/test-strategy.md
 * previously noted "E2E is a follow-up ticket once Playwright is
 * introduced") -- just enough config to run one login flow against a real
 * dev server + local Supabase stack.
 *
 * Local-only for now, not wired into `.github/workflows/ci.yml`/required
 * branch protection: it needs both `supabase start` (Auth + Postgres) and a
 * running Next.js server at the same time, and no CI job currently
 * provisions both together. See `apps/web/e2e/login.spec.ts` and the PR
 * description for the explicit "why not CI yet" note. Follow-up: once a CI
 * job runs `supabase start` (as migration-check.yml already does) plus
 * `next build && next start` in the same job, promote this to the "E2E
 * Smoke" gate in docs/testing/test-strategy.md's CI gate order.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
