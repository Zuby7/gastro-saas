import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

/**
 * End-to-end proof of ticket #7's registration -> login round trip, against
 * a real running dev server + local Supabase stack (Auth + Postgres).
 * Requires `supabase start` to be running; `pnpm dev` is started
 * automatically by Playwright's `webServer` config (or reused if already
 * running -- see playwright.config.ts).
 *
 * Registers a brand-new random user (no pre-seeded fixture needed -- this
 * intentionally exercises the real registration RPC end-to-end, not a
 * shortcut), then logs out and back in with the same credentials to prove
 * the login flow and cookie-based session handling work end-to-end.
 */
test("registers a new owner, then logs out and back in", async ({ page }) => {
  const unique = randomUUID().slice(0, 8);
  const email = `e2e-owner-${unique}@example.test`;
  const password = "Sup3rSecureE2EPassw0rd!";
  const tenantName = `E2E Test Tenant ${unique}`;
  const tenantSlug = `e2e-test-tenant-${unique}`;

  await page.goto("/register");
  await page.getByLabel("Restaurantname").fill(tenantName);
  await page.getByLabel(/Restaurant-Slug/).fill(tenantSlug);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Registrieren" }).click();

  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText(tenantName)).toBeVisible();

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();

  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByText(email)).toBeVisible();
});

test("shows a generic error for a wrong password, without revealing whether the email exists", async ({
  page,
}) => {
  const unique = randomUUID().slice(0, 8);
  const email = `e2e-wrongpass-${unique}@example.test`;

  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort").fill("someWrongPassword123!");
  await page.getByRole("button", { name: "Anmelden" }).click();

  await expect(page.getByRole("alert")).toHaveText("E-Mail-Adresse oder Passwort ist ungültig.");
  await expect(page).toHaveURL(/\/login/);
});
