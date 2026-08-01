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
    throw new Error(`[menu-management.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(`[menu-management.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`);
}

describe.skipIf(!dbAvailable)("restaurant profile and menu management", () => {
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

  it("saves tenant-scoped profile/opening hours and rejects contradictory hours", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;

    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into restaurant_profiles (tenant_id, display_name, timezone, updated_by_user_id)
       values ($1, 'Mario', 'Europe/Berlin', $2)`,
      [tenantA.tenantId, tenantA.ownerId],
    );
    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into opening_hours (tenant_id, weekday, opens_at, closes_at)
       values ($1, 1, '09:00', '17:00')`,
      [tenantA.tenantId],
    );

    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `insert into opening_hours (tenant_id, weekday, opens_at, closes_at)
         values ($1, 2, '18:00', '12:00')`,
        [tenantA.tenantId],
      ),
    ).rejects.toThrow(/opening_hours_check/i);

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantB.ownerId,
      sql: `select tenant_id from restaurant_profiles where tenant_id = $1`,
      params: [tenantA.tenantId],
    });
  });

  it("validates image metadata, menu draft privacy, assignments, and publish blockers", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
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
      `insert into dishes (id, tenant_id, menu_version_id, category_id, name)
       values ($1, $2, $3, $4, 'Margherita')`,
      [dishId, tenantA.tenantId, draftId, categoryId],
    );

    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `insert into media_assets (tenant_id, storage_path, content_type, size_bytes, alt_text)
         values ($1, $2, 'application/pdf', 100, 'menu')`,
        [tenantA.tenantId, `${tenantA.tenantId}/bad.pdf`],
      ),
    ).rejects.toThrow(/media_assets_content_type_check/i);

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantB.ownerId,
      sql: `select id from dishes where tenant_id = $1`,
      params: [tenantA.tenantId],
    });

    const checks = await queryAsUser<{ severity: string; code: string }>(
      admin,
      tenantA.ownerId,
      `select severity, code from run_menu_publish_checks($1)`,
      [draftId],
    );
    expect(checks.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "blocker", code: "dish-without-price" }),
      ]),
    );

    await expect(
      queryAsUser(admin, tenantA.ownerId, `select publish_menu_version($1)`, [draftId]),
    ).rejects.toThrow(/blockers/i);

    await queryAsUser(
      admin,
      tenantA.ownerId,
      `update dishes set price_cents = 900, allergen_reviewed = true where id = $1`,
      [dishId],
    );
    await queryAsUser(admin, tenantA.ownerId, `select publish_menu_version($1)`, [draftId]);

    const published = await admin.query(
      `select published_at, published_by_user_id from menu_versions where id = $1 and status = 'published'`,
      [draftId],
    );
    expect(published.rows[0]?.published_by_user_id).toBe(tenantA.ownerId);
    expect(published.rows[0]?.published_at).not.toBeNull();
  });

  it("public menu query returns only one tenant's published menu and hides drafts", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    const draftAId = randomUUID();
    const draftBId = randomUUID();
    const categoryAId = randomUUID();
    const categoryBId = randomUUID();

    await admin.query(
      `insert into menu_versions (id, tenant_id, status) values ($1, $2, 'draft'), ($3, $4, 'draft')`,
      [draftAId, tenantA.tenantId, draftBId, tenantB.tenantId],
    );
    await admin.query(
      `insert into categories (id, tenant_id, menu_version_id, name, sort_order)
       values ($1, $2, $3, 'Tenant A Category', 1), ($4, $5, $6, 'Tenant B Category', 1)`,
      [categoryAId, tenantA.tenantId, draftAId, categoryBId, tenantB.tenantId, draftBId],
    );
    await admin.query(
      `insert into dishes (tenant_id, menu_version_id, category_id, name, price_cents, allergen_reviewed)
       values ($1, $2, $3, 'Tenant A Dish', 1000, true), ($4, $5, $6, 'Tenant B Dish', 2000, true)`,
      [tenantA.tenantId, draftAId, categoryAId, tenantB.tenantId, draftBId, categoryBId],
    );

    const hiddenDraft = await admin.query<{ menu: unknown }>(`select get_public_menu($1) as menu`, [
      tenantA.slug,
    ]);
    expect(hiddenDraft.rows[0]?.menu).toBeNull();

    await queryAsUser(admin, tenantA.ownerId, `select publish_menu_version($1)`, [draftAId]);

    const publicMenu = await admin.query<{
      menu: { categories: { dishes: { name: string }[] }[] };
    }>(`select get_public_menu($1) as menu`, [tenantA.slug]);
    const dishNames = publicMenu.rows[0]!.menu.categories.flatMap((category) =>
      category.dishes.map((dish) => dish.name),
    );
    expect(dishNames).toContain("Tenant A Dish");
    expect(dishNames).not.toContain("Tenant B Dish");
  });
});
