import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  expectCrossTenantDenied,
  queryAsUser,
  seedTwoTenantFixture,
  type TwoTenantFixture,
} from "@gastro-saas/testing";

const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const isCiEnvironment = Boolean(process.env.CI) || Boolean(process.env.SUPABASE_DB_URL);

async function probeDatabase(): Promise<boolean> {
  const probe = new Client({ connectionString: DB_URL });
  try {
    await probe.connect();
    await probe.end();
    return true;
  } catch {
    return false;
  }
}

const dbAvailable = await probeDatabase();

if (!dbAvailable) {
  if (isCiEnvironment) {
    throw new Error(`[legal-pages.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(`[legal-pages.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`);
}

/**
 * Covers ticket #41's migration
 * (`supabase/migrations/20260820100000_legal_pages_impressum_datenschutz_consent.sql`):
 * the new `restaurant_profiles.legal_imprint_text`/`legal_privacy_text`
 * columns (reusing that table's existing RLS), the dedicated public
 * `get_public_legal_page()` read function, and the two new non-blocking
 * publish-check warnings.
 */
describe.skipIf(!dbAvailable)("Impressum/Datenschutz legal pages", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    await fixture?.cleanup();
  });

  afterAll(async () => {
    await admin.end();
  });

  it("saves legal text scoped to the caller's own tenant and denies cross-tenant reads", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;

    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into restaurant_profiles (tenant_id, display_name, legal_imprint_text, legal_privacy_text, updated_by_user_id)
       values ($1, 'Mario', 'Mario GmbH, Musterstr. 1', 'Wir verarbeiten Ihre Daten gemäß DSGVO.', $2)`,
      [tenantA.tenantId, tenantA.ownerId],
    );

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantB.ownerId,
      sql: `select legal_imprint_text from restaurant_profiles where tenant_id = $1`,
      params: [tenantA.tenantId],
    });
  });

  it("denies writing legal text without tenant.settings.write", async () => {
    const staffUserId = randomUUID();
    fixture = await seedTwoTenantFixture(admin, {
      tenantA: { additionalMembers: [{ userId: staffUserId, role: "staff" }] },
    });
    const { tenantA } = fixture;

    // "staff" is not granted tenant.settings.write by
    // 20260801110000_restaurant_profile_and_menu_management.sql (only
    // owner/manager are) -- this exercises the *denied* case per
    // .claude/rules/testing.md's "any change to a permission boundary needs
    // a test for the denied case" rule.
    await expectCrossTenantDenied({
      client: admin,
      actorUserId: staffUserId,
      sql: `insert into restaurant_profiles (tenant_id, display_name, legal_imprint_text)
            values ($1, 'Mario', 'should not be writable') returning tenant_id`,
      params: [tenantA.tenantId],
    });
  });

  it("get_public_legal_page() returns only the requested tenant's text, narrowly scoped", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;

    await admin.query(
      `insert into restaurant_profiles (tenant_id, display_name, legal_imprint_text, legal_privacy_text)
       values ($1, 'Mario', 'Mario GmbH, Musterstr. 1', 'Datenschutz-Text A')`,
      [tenantA.tenantId],
    );
    await admin.query(
      `insert into restaurant_profiles (tenant_id, display_name, legal_imprint_text, legal_privacy_text)
       values ($1, 'Luigi', 'Luigi GmbH, Musterstr. 2', 'Datenschutz-Text B')`,
      [tenantB.tenantId],
    );

    const imprint = await admin.query<{ get_public_legal_page: { tenantName: string; text: string } }>(
      `select get_public_legal_page($1, 'imprint') as get_public_legal_page`,
      [tenantA.slug],
    );
    expect(imprint.rows[0]?.get_public_legal_page).toEqual({
      tenantName: "Mario",
      text: "Mario GmbH, Musterstr. 1",
    });

    const privacy = await admin.query<{ get_public_legal_page: { tenantName: string; text: string } }>(
      `select get_public_legal_page($1, 'privacy') as get_public_legal_page`,
      [tenantB.slug],
    );
    expect(privacy.rows[0]?.get_public_legal_page).toEqual({
      tenantName: "Luigi",
      text: "Datenschutz-Text B",
    });

    const unknownSlug = await admin.query(
      `select get_public_legal_page('does-not-exist', 'imprint') as get_public_legal_page`,
    );
    expect(unknownSlug.rows[0]?.get_public_legal_page).toBeNull();

    await expect(
      admin.query(`select get_public_legal_page($1, 'not-a-real-page')`, [tenantA.slug]),
    ).rejects.toThrow(/Unknown legal page/i);
  });

  it("raises non-blocking publish-check warnings when Impressum/Datenschutz text is missing, and clears them once filled in", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const draftId = randomUUID();
    const categoryId = randomUUID();
    const dishId = randomUUID();

    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into menu_versions (id, tenant_id, status) values ($1, $2, 'draft')`,
      [draftId, tenantA.tenantId],
    );
    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into categories (id, tenant_id, menu_version_id, name, sort_order)
       values ($1, $2, $3, 'Pizza', 1)`,
      [categoryId, tenantA.tenantId, draftId],
    );
    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into dishes (id, tenant_id, menu_version_id, category_id, name, price_cents, allergen_reviewed)
       values ($1, $2, $3, $4, 'Margherita', 900, true)`,
      [dishId, tenantA.tenantId, draftId, categoryId],
    );

    const checksMissing = await queryAsUser<{ severity: string; code: string }>(
      admin,
      tenantA.ownerId,
      `select severity, code from run_menu_publish_checks($1)`,
      [draftId],
    );
    expect(checksMissing.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "warning", code: "imprint-text-missing" }),
        expect.objectContaining({ severity: "warning", code: "privacy-text-missing" }),
      ]),
    );
    // Never a blocker -- the menu must still be publishable.
    expect(checksMissing.rows.some((r) => r.severity === "blocker")).toBe(false);
    await queryAsUser(admin, tenantA.ownerId, `select publish_menu_version($1)`, [draftId]);

    // Fill in the legal text for a second draft (publish_menu_version() clones
    // a fresh draft automatically) and confirm the warnings clear.
    const secondDraft = await admin.query<{ id: string }>(
      `select id from menu_versions where tenant_id = $1 and status = 'draft'`,
      [tenantA.tenantId],
    );
    const secondDraftId = secondDraft.rows[0]!.id;

    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into restaurant_profiles (tenant_id, display_name, legal_imprint_text, legal_privacy_text, updated_by_user_id)
       values ($1, 'Mario', 'Mario GmbH, Musterstr. 1', 'Wir verarbeiten Ihre Daten gemäß DSGVO.', $2)
       on conflict (tenant_id) do update
         set legal_imprint_text = excluded.legal_imprint_text,
             legal_privacy_text = excluded.legal_privacy_text`,
      [tenantA.tenantId, tenantA.ownerId],
    );

    const checksFilled = await queryAsUser<{ severity: string; code: string }>(
      admin,
      tenantA.ownerId,
      `select severity, code from run_menu_publish_checks($1)`,
      [secondDraftId],
    );
    expect(checksFilled.rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "imprint-text-missing" }),
        expect.objectContaining({ code: "privacy-text-missing" }),
      ]),
    );
  });
});
