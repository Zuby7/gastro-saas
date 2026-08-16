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

  // Regression test for a Codex review finding: publish_menu_version() used
  // to transition the draft in place with nothing blocking further writes to
  // it, so an admin could silently edit the live/published menu. Fixed by a
  // write-guard trigger (locks categories/dishes/... once their menu_version
  // leaves 'draft') plus auto-cloning a fresh draft on publish.
  it("locks a published menu version against writes and auto-creates a fresh editable draft", async () => {
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

    await queryAsUser(admin, tenantA.ownerId, `select publish_menu_version($1)`, [draftId]);

    // The just-published version's dish is now read-only.
    await expect(
      queryAsUser(admin, tenantA.ownerId, `update dishes set price_cents = 1000 where id = $1`, [
        dishId,
      ]),
    ).rejects.toThrow(/read-only/i);
    await expect(
      queryAsUser(admin, tenantA.ownerId, `delete from dishes where id = $1`, [dishId]),
    ).rejects.toThrow(/read-only/i);

    // A fresh draft with the same structure now exists for further editing.
    const newDraft = await admin.query<{ id: string }>(
      `select id from menu_versions where tenant_id = $1 and status = 'draft'`,
      [tenantA.tenantId],
    );
    expect(newDraft.rows).toHaveLength(1);
    const newDraftId = newDraft.rows[0]?.id;
    expect(newDraftId).not.toBe(draftId);

    const clonedDish = await admin.query<{ name: string; price_cents: number }>(
      `select d.name, d.price_cents
         from dishes d
         join categories c on c.id = d.category_id
        where c.menu_version_id = $1`,
      [newDraftId],
    );
    expect(clonedDish.rows).toEqual([
      expect.objectContaining({ name: "Margherita", price_cents: 900 }),
    ]);

    // The cloned dish is fully editable (it belongs to the new draft, not
    // the published version).
    await queryAsUser(
      admin,
      tenantA.ownerId,
      `update dishes set price_cents = 950 where name = 'Margherita' and menu_version_id = $1`,
      [newDraftId],
    );
  });

  // Regression test for the Opus batch review (epic-3-5-batch, critical):
  // menu_versions' basic RLS UPDATE policy only checked menu.write, so a
  // menu.write-only role could directly set status = 'published' (or flip a
  // published version back to 'draft'), completely bypassing
  // publish_menu_version()'s menu.publish check, blocker validation, and
  // audit log. Fixed by guard_menu_versions_status_change().
  it("rejects direct menu_versions.status writes outside publish_menu_version()", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const draftId = randomUUID();

    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into menu_versions (id, tenant_id, status) values ($1, $2, 'draft')`,
      [draftId, tenantA.tenantId],
    );

    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `update menu_versions set status = 'published' where id = $1`,
        [draftId],
      ),
    ).rejects.toThrow(/can only be changed by publish_menu_version/i);

    const stillDraft = await admin.query<{ status: string }>(
      `select status from menu_versions where id = $1`,
      [draftId],
    );
    expect(stillDraft.rows[0]?.status).toBe("draft");

    // Publishing legitimately, then trying to flip it back to 'draft'
    // directly (which used to let an admin re-edit a "published" version)
    // must also be rejected.
    await admin.query(
      `insert into categories (tenant_id, menu_version_id, name, sort_order) values ($1, $2, 'Pizza', 1)`,
      [tenantA.tenantId, draftId],
    );
    await admin.query(
      `insert into dishes (tenant_id, menu_version_id, category_id, name, price_cents, allergen_reviewed)
       select $1, $2, c.id, 'Margherita', 900, true from categories c
        where c.menu_version_id = $2`,
      [tenantA.tenantId, draftId],
    );
    await queryAsUser(admin, tenantA.ownerId, `select publish_menu_version($1)`, [draftId]);

    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `update menu_versions set status = 'draft' where id = $1`,
        [draftId],
      ),
    ).rejects.toThrow(/can only be changed by publish_menu_version/i);
  });

  // Regression test for the Opus batch review (epic-3-5-batch, high):
  // run_menu_publish_checks() is SECURITY DEFINER with no tenant-membership
  // check, so any authenticated user (of any tenant) could read another
  // tenant's unpublished dish names via this RPC.
  it("rejects cross-tenant calls to run_menu_publish_checks", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    const draftId = randomUUID();

    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into menu_versions (id, tenant_id, status) values ($1, $2, 'draft')`,
      [draftId, tenantA.tenantId],
    );

    await expect(
      queryAsUser(admin, tenantB.ownerId, `select run_menu_publish_checks($1)`, [draftId]),
    ).rejects.toThrow(/Missing permission menu\.write|permission denied|insufficient_privilege/i);
  });

  // Regression test for ticket #69 (Opus batch review, epic-3-5-batch, cycle
  // 2): clone_menu_version_as_draft() used to derive version_number from
  // SOURCE.version_number + 1, so cloning from an older (non-latest) version
  // could collide with an already-existing later version_number. Now
  // derived from max(version_number) + 1 across the whole tenant, and a
  // unique index on (tenant_id, version_number) enforces it at the DB level
  // regardless of caller.
  it("derives a cloned draft's version_number from the tenant's max version, not source+1, avoiding collisions", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const v1Id = randomUUID();
    const v2Id = randomUUID();

    // Simulate a tenant with a published v1 and an archived v2 (e.g. v1 was
    // republished after v2), with no current draft -- so cloning is legal
    // (single-draft invariant not in play) but v1.version_number + 1 (the
    // old buggy formula) would collide with v2's version_number.
    await admin.query(
      `insert into menu_versions (id, tenant_id, status, version_number)
       values ($1, $2, 'published', 1), ($3, $2, 'archived', 2)`,
      [v1Id, tenantA.tenantId, v2Id],
    );

    // clone_menu_version_as_draft() is only granted to service_role (called
    // internally by publish_menu_version()), so this test calls it directly
    // as the admin/superuser connection, same as the other admin.query calls
    // above that seed menu_versions rows.
    const cloned = await admin.query<{ clone_menu_version_as_draft: string }>(
      `select clone_menu_version_as_draft($1)`,
      [v1Id],
    );
    const newDraftId = cloned.rows[0]?.clone_menu_version_as_draft;
    expect(newDraftId).toBeTruthy();

    const newDraft = await admin.query<{ version_number: number; status: string }>(
      `select version_number, status from menu_versions where id = $1`,
      [newDraftId],
    );
    // max(1, 2) + 1 = 3, not source(1) + 1 = 2 (which would have collided
    // with v2's version_number).
    expect(newDraft.rows[0]).toEqual(
      expect.objectContaining({ version_number: 3, status: "draft" }),
    );
  });

  // Regression test for ticket #69: nothing previously enforced "at most one
  // draft per tenant" at the DB level -- a tenant could end up with two
  // concurrent drafts. A partial unique index on (tenant_id) where
  // status = 'draft' now rejects this outright.
  it("rejects a second concurrent draft for the same tenant (single-draft invariant)", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const publishedId = randomUUID();
    const existingDraftId = randomUUID();

    await admin.query(
      `insert into menu_versions (id, tenant_id, status, version_number)
       values ($1, $2, 'published', 1), ($3, $2, 'draft', 2)`,
      [publishedId, tenantA.tenantId, existingDraftId],
    );

    await expect(
      admin.query(`select clone_menu_version_as_draft($1)`, [publishedId]),
    ).rejects.toThrow(/duplicate key value violates unique constraint/i);
  });

  // Regression test for ticket #69: the original implementation used
  // `create temporary table ... on commit drop` id-mapping tables, which
  // fail with "relation already exists" if clone_menu_version_as_draft() is
  // called a second time within the SAME transaction (on commit drop only
  // drops at transaction end, not between statements). Rewritten with CTEs
  // instead, which carry no cross-call session state.
  it("does not fail with a temp-table name collision when called twice in the same transaction", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    const sourceAId = randomUUID();
    const sourceBId = randomUUID();

    await admin.query(
      `insert into menu_versions (id, tenant_id, status, version_number)
       values ($1, $2, 'published', 1), ($3, $4, 'published', 1)`,
      [sourceAId, tenantA.tenantId, sourceBId, tenantB.tenantId],
    );

    await admin.query("begin");
    try {
      const firstClone = await admin.query<{ clone_menu_version_as_draft: string }>(
        `select clone_menu_version_as_draft($1)`,
        [sourceAId],
      );
      const secondClone = await admin.query<{ clone_menu_version_as_draft: string }>(
        `select clone_menu_version_as_draft($1)`,
        [sourceBId],
      );
      await admin.query("commit");

      expect(firstClone.rows[0]?.clone_menu_version_as_draft).toBeTruthy();
      expect(secondClone.rows[0]?.clone_menu_version_as_draft).toBeTruthy();
    } catch (error) {
      await admin.query("rollback");
      throw error;
    }
  });

  // Opus review finding on PR #104: the tests above for the
  // clone_menu_version_as_draft() rewrite only ever clone an EMPTY dish (no
  // variants/option-group/allergen/dietary-label assignments), so the CTE
  // rewrite's forced-dependency joins for those specific child tables were
  // never actually exercised end-to-end. This test clones a fully-populated
  // dish and asserts every child row survives correctly in the clone.
  it("clones a dish's variants, option-group assignment, allergen assignment, and dietary-label assignment", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const sourceId = randomUUID();
    const categoryId = randomUUID();
    const dishId = randomUUID();
    const optionGroupId = randomUUID();
    const allergenId = randomUUID();
    const dietaryLabelId = randomUUID();

    // Inserted as 'draft' first -- categories/dishes are read-only once their
    // menu_version leaves 'draft' status (the write-guard from ticket #7's
    // fix cycle), so all child rows must be populated before flipping this
    // source version to 'published' below.
    await admin.query(
      `insert into menu_versions (id, tenant_id, status, version_number) values ($1, $2, 'draft', 1)`,
      [sourceId, tenantA.tenantId],
    );
    await admin.query(
      `insert into categories (id, tenant_id, menu_version_id, name, sort_order)
       values ($1, $2, $3, 'Pizza', 1)`,
      [categoryId, tenantA.tenantId, sourceId],
    );
    await admin.query(
      `insert into dishes (id, tenant_id, menu_version_id, category_id, name, allergen_reviewed)
       values ($1, $2, $3, $4, 'Margherita', true)`,
      [dishId, tenantA.tenantId, sourceId, categoryId],
    );
    await admin.query(
      `insert into dish_variants (tenant_id, dish_id, name, price_cents, is_available)
       values ($1, $2, 'Groß', 1200, true)`,
      [tenantA.tenantId, dishId],
    );
    await admin.query(`insert into option_groups (id, tenant_id, name) values ($1, $2, 'Größe')`, [
      optionGroupId,
      tenantA.tenantId,
    ]);
    await admin.query(
      `insert into dish_option_group_assignments (dish_id, option_group_id, tenant_id, sort_order)
       values ($1, $2, $3, 1)`,
      [dishId, optionGroupId, tenantA.tenantId],
    );
    await admin.query(`insert into allergens (id, tenant_id, name) values ($1, $2, 'Gluten')`, [
      allergenId,
      tenantA.tenantId,
    ]);
    await admin.query(
      `insert into dish_allergen_assignments (dish_id, allergen_id, tenant_id) values ($1, $2, $3)`,
      [dishId, allergenId, tenantA.tenantId],
    );
    await admin.query(
      `insert into dietary_labels (id, tenant_id, name) values ($1, $2, 'Vegetarisch')`,
      [dietaryLabelId, tenantA.tenantId],
    );
    await admin.query(
      `insert into dish_dietary_label_assignments (dish_id, dietary_label_id, tenant_id) values ($1, $2, $3)`,
      [dishId, dietaryLabelId, tenantA.tenantId],
    );

    // admin.query runs as the postgres superuser, not an app-facing role
    // (authenticated/anon/service_role), so guard_menu_versions_status_change()
    // does not restrict this direct status flip -- same precedent as the
    // temp-table-collision test above, which does the same thing.
    await admin.query(`update menu_versions set status = 'published' where id = $1`, [sourceId]);

    const cloned = await admin.query<{ clone_menu_version_as_draft: string }>(
      `select clone_menu_version_as_draft($1)`,
      [sourceId],
    );
    const newDraftId = cloned.rows[0]?.clone_menu_version_as_draft;
    expect(newDraftId).toBeTruthy();

    const clonedDish = await admin.query<{ id: string; name: string }>(
      `select d.id, d.name
         from dishes d
         join categories c on c.id = d.category_id
        where c.menu_version_id = $1`,
      [newDraftId],
    );
    expect(clonedDish.rows).toHaveLength(1);
    const clonedDishId = clonedDish.rows[0]!.id;
    expect(clonedDishId).not.toBe(dishId);

    const clonedVariants = await admin.query<{ name: string; price_cents: number }>(
      `select name, price_cents from dish_variants where dish_id = $1`,
      [clonedDishId],
    );
    expect(clonedVariants.rows).toEqual([
      expect.objectContaining({ name: "Groß", price_cents: 1200 }),
    ]);

    const clonedOptionGroups = await admin.query<{ option_group_id: string }>(
      `select option_group_id from dish_option_group_assignments where dish_id = $1`,
      [clonedDishId],
    );
    // option_groups are tenant-scoped, not version-scoped -- referenced as-is.
    expect(clonedOptionGroups.rows).toEqual([
      expect.objectContaining({ option_group_id: optionGroupId }),
    ]);

    const clonedAllergens = await admin.query<{ allergen_id: string }>(
      `select allergen_id from dish_allergen_assignments where dish_id = $1`,
      [clonedDishId],
    );
    expect(clonedAllergens.rows).toEqual([expect.objectContaining({ allergen_id: allergenId })]);

    const clonedDietaryLabels = await admin.query<{ dietary_label_id: string }>(
      `select dietary_label_id from dish_dietary_label_assignments where dish_id = $1`,
      [clonedDishId],
    );
    expect(clonedDietaryLabels.rows).toEqual([
      expect.objectContaining({ dietary_label_id: dietaryLabelId }),
    ]);
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

  // Regression test for ticket #84: get_public_menu() previously hardcoded
  // 'soldOut', false for every dish, so the frontend's sold-out UI never
  // triggered regardless of variant availability. Now derived using the
  // same "is this dish purchasable" formula as run_menu_publish_checks()'s
  // 'no-purchasable-dish' blocker: purchasable if the dish has its own
  // price_cents OR at least one available variant; soldOut is the negation.
  //
  // A dish with zero purchasable variants (and no base price) can never be
  // *published* in the first place (the 'dish-without-price' blocker
  // rejects it) -- the realistic path to a sold-out published dish is
  // toggling an already-published dish's only variant to
  // is_available = false afterwards, which
  // 20260803100000_dish_variant_availability_toggle_exemption.sql
  // deliberately allows on a published menu version.
  it("derives soldOut from dish_variants.is_available instead of hardcoding false", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const draftId = randomUUID();
    const categoryId = randomUUID();
    const priceOnlyDishId = randomUUID();
    const variantOnlyDishId = randomUUID();
    const variantId = randomUUID();

    await admin.query(
      `insert into menu_versions (id, tenant_id, status) values ($1, $2, 'draft')`,
      [draftId, tenantA.tenantId],
    );
    await admin.query(
      `insert into categories (id, tenant_id, menu_version_id, name, sort_order)
       values ($1, $2, $3, 'Pizza', 1)`,
      [categoryId, tenantA.tenantId, draftId],
    );
    await admin.query(
      `insert into dishes (id, tenant_id, menu_version_id, category_id, name, price_cents, allergen_reviewed)
       values
         ($1, $3, $4, $5, 'Has own price', 900, true),
         ($2, $3, $4, $5, 'Priced only via variant', null, true)`,
      [priceOnlyDishId, variantOnlyDishId, tenantA.tenantId, draftId, categoryId],
    );
    await admin.query(
      `insert into dish_variants (id, tenant_id, dish_id, name, price_cents, is_available)
       values ($1, $2, $3, 'Groß', 1200, true)`,
      [variantId, tenantA.tenantId, variantOnlyDishId],
    );

    await queryAsUser(admin, tenantA.ownerId, `select publish_menu_version($1)`, [draftId]);

    const beforeToggle = await admin.query<{
      menu: { categories: { dishes: { name: string; soldOut: boolean }[] }[] };
    }>(`select get_public_menu($1) as menu`, [tenantA.slug]);
    const dishesBefore = beforeToggle.rows[0]!.menu.categories.flatMap(
      (category) => category.dishes,
    );
    const soldOutBefore = Object.fromEntries(dishesBefore.map((dish) => [dish.name, dish.soldOut]));

    expect(soldOutBefore["Has own price"]).toBe(false);
    expect(soldOutBefore["Priced only via variant"]).toBe(false);

    // Staff marks the dish's only variant unavailable on the now-published
    // menu (permitted by the availability-toggle exemption).
    await admin.query(`update dish_variants set is_available = false where id = $1`, [variantId]);

    const afterToggle = await admin.query<{
      menu: { categories: { dishes: { name: string; soldOut: boolean }[] }[] };
    }>(`select get_public_menu($1) as menu`, [tenantA.slug]);
    const dishesAfter = afterToggle.rows[0]!.menu.categories.flatMap((category) => category.dishes);
    const soldOutAfter = Object.fromEntries(dishesAfter.map((dish) => [dish.name, dish.soldOut]));

    expect(soldOutAfter["Has own price"]).toBe(false);
    expect(soldOutAfter["Priced only via variant"]).toBe(true);
  });
});
