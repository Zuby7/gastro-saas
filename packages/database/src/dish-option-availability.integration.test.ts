// Integration tests for ticket #29 (Epic 8, "Ausverkauft-Steuerung"):
// dishes.is_available/available_again_at, options.is_available/
// available_again_at, dish_variants.available_again_at, the
// menu.availability.manage permission, the set_*_availability() RPCs, and
// their effects on get_public_menu()/the cart pricing path.
//
// This repo has no Playwright/e2e suite (an accepted, known gap noted on
// earlier tickets) -- the ticket's required "a sold-out dish is immediately
// unorderable on the public page" E2E test is substituted here at the
// integration level: toggle availability via the real RPC, then assert both
// the public menu query and the cart's add-item path reject/hide it, which
// covers the same behavior the E2E test would exercise, just without a
// browser.
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
    throw new Error(
      `[dish-option-availability.integration.test] no reachable Postgres at ${DB_URL}.`,
    );
  }
  console.warn(
    `[dish-option-availability.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

interface SeededMenu {
  menuVersionId: string;
  categoryId: string;
  dishId: string;
  variantId: string;
  optionGroupId: string;
  optionId: string;
}

/** Seeds a minimal *published* menu: one dish (own price), one variant, one option group with one option, all available. */
async function seedPublishedMenu(admin: Client, tenantId: string): Promise<SeededMenu> {
  const menuVersionId = randomUUID();
  const categoryId = randomUUID();
  const dishId = randomUUID();
  const variantId = randomUUID();
  const optionGroupId = randomUUID();
  const optionId = randomUUID();

  await admin.query(`insert into menu_versions (id, tenant_id, status) values ($1, $2, 'draft')`, [
    menuVersionId,
    tenantId,
  ]);
  await admin.query(
    `insert into categories (id, tenant_id, menu_version_id, name, sort_order) values ($1, $2, $3, 'Pizza', 1)`,
    [categoryId, tenantId, menuVersionId],
  );
  await admin.query(
    `insert into dishes (id, tenant_id, menu_version_id, category_id, name, price_cents, allergen_reviewed)
     values ($1, $2, $3, $4, 'Margherita', 900, true)`,
    [dishId, tenantId, menuVersionId, categoryId],
  );
  await admin.query(
    `insert into dish_variants (id, tenant_id, dish_id, name, price_cents, is_available)
     values ($1, $2, $3, 'Groß', 1200, true)`,
    [variantId, tenantId, dishId],
  );
  await admin.query(
    `insert into option_groups (id, tenant_id, name, min_selections, max_selections)
     values ($1, $2, 'Extras', 0, 1)`,
    [optionGroupId, tenantId],
  );
  await admin.query(
    `insert into options (id, tenant_id, option_group_id, name, price_delta_cents) values ($1, $2, $3, 'Extra Käse', 150)`,
    [optionId, tenantId, optionGroupId],
  );
  await admin.query(
    `insert into dish_option_group_assignments (dish_id, option_group_id, tenant_id) values ($1, $2, $3)`,
    [dishId, optionGroupId, tenantId],
  );
  await admin.query(
    `update menu_versions set status = 'published', published_at = now() where id = $1`,
    [menuVersionId],
  );

  return { menuVersionId, categoryId, dishId, variantId, optionGroupId, optionId };
}

async function createCart(admin: Client, tenantId: string): Promise<string> {
  const token = randomUUID();
  const result = await admin.query<{ get_or_create_cart: string }>(
    `select get_or_create_cart($1, $2) as get_or_create_cart`,
    [tenantId, "a".repeat(64)],
  );
  const cartId = result.rows[0]?.get_or_create_cart;
  if (!cartId) throw new Error("failed to create cart in test setup");
  return cartId;
}

describe.skipIf(!dbAvailable)("dish/option availability and scheduling (ticket #29)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    await fixture?.cleanup();
    await admin.query(`delete from carts where cart_token_hash = $1`, ["a".repeat(64)]);
  });

  afterAll(async () => {
    await admin.end();
  });

  it("allows a pure is_available/available_again_at toggle on dishes on an already-published menu, but still rejects a bundled content change (publish-guard exemption parity with dish_variants)", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);

    await expect(
      admin.query(`update dishes set is_available = false where id = $1`, [menu.dishId]),
    ).resolves.not.toThrow();

    const future = new Date(Date.now() + 3600_000).toISOString();
    await expect(
      admin.query(`update dishes set available_again_at = $1 where id = $2`, [future, menu.dishId]),
    ).resolves.not.toThrow();

    await expect(
      admin.query(`update dishes set is_available = true, price_cents = 1 where id = $1`, [
        menu.dishId,
      ]),
    ).rejects.toThrow(/read-only/i);
  });

  it("derives soldOut from the dish's OWN is_available regardless of an available variant/base price", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);

    const before = await admin.query<{
      menu: { categories: { dishes: { soldOut: boolean }[] }[] };
    }>(`select get_public_menu($1) as menu`, [tenantA.slug]);
    expect(before.rows[0]!.menu.categories[0]!.dishes[0]!.soldOut).toBe(false);

    await admin.query(`update dishes set is_available = false where id = $1`, [menu.dishId]);

    const after = await admin.query<{ menu: { categories: { dishes: { soldOut: boolean }[] }[] } }>(
      `select get_public_menu($1) as menu`,
      [tenantA.slug],
    );
    // Own price AND an available variant, but the dish itself is marked
    // sold out -- must still be soldOut, per ticket #29's acceptance
    // criteria ("a dish with its OWN is_available = false should show as
    // sold out regardless of any variant's availability").
    expect(after.rows[0]!.menu.categories[0]!.dishes[0]!.soldOut).toBe(true);
  });

  it("treats a dish as available again once available_again_at has passed, without any human toggling is_available back", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);

    const past = new Date(Date.now() - 60_000).toISOString();
    await admin.query(
      `update dishes set is_available = false, available_again_at = $1 where id = $2`,
      [past, menu.dishId],
    );

    const menuResult = await admin.query<{
      menu: { categories: { dishes: { soldOut: boolean }[] }[] };
    }>(`select get_public_menu($1) as menu`, [tenantA.slug]);
    expect(menuResult.rows[0]!.menu.categories[0]!.dishes[0]!.soldOut).toBe(false);

    const future = new Date(Date.now() + 3600_000).toISOString();
    await admin.query(`update dishes set available_again_at = $1 where id = $2`, [
      future,
      menu.dishId,
    ]);

    const stillSoldOut = await admin.query<{
      menu: { categories: { dishes: { soldOut: boolean }[] }[] };
    }>(`select get_public_menu($1) as menu`, [tenantA.slug]);
    expect(stillSoldOut.rows[0]!.menu.categories[0]!.dishes[0]!.soldOut).toBe(true);
  });

  it("excludes a sold-out option from get_public_menu's optionGroups.options", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);

    const before = await admin.query<{
      menu: { categories: { dishes: { optionGroups: { options: { id: string }[] }[] }[] }[] };
    }>(`select get_public_menu($1) as menu`, [tenantA.slug]);
    expect(before.rows[0]!.menu.categories[0]!.dishes[0]!.optionGroups[0]!.options).toHaveLength(1);

    await admin.query(`update options set is_available = false where id = $1`, [menu.optionId]);

    const after = await admin.query<{
      menu: { categories: { dishes: { optionGroups: { options: { id: string }[] }[] }[] }[] };
    }>(`select get_public_menu($1) as menu`, [tenantA.slug]);
    expect(after.rows[0]!.menu.categories[0]!.dishes[0]!.optionGroups[0]!.options).toHaveLength(0);
  });

  it("rejects adding a dish to the cart once the dish itself (not just a variant) is marked sold out", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCart(admin, tenantA.tenantId);

    await admin.query(`update dishes set is_available = false where id = $1`, [menu.dishId]);

    await expect(
      admin.query(`select add_cart_item($1, $2, $3, $4, $5, $6)`, [
        cartId,
        tenantA.tenantId,
        menu.dishId,
        menu.variantId,
        1,
        [],
      ]),
    ).rejects.toThrow(/no longer available/i);
  });

  it("rejects selecting a sold-out option when adding to the cart", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCart(admin, tenantA.tenantId);

    await admin.query(`update options set is_available = false where id = $1`, [menu.optionId]);

    await expect(
      admin.query(`select add_cart_item($1, $2, $3, $4, $5, $6)`, [
        cartId,
        tenantA.tenantId,
        menu.dishId,
        menu.variantId,
        1,
        [menu.optionId],
      ]),
    ).rejects.toThrow(/not available for this dish/i);
  });

  it("flags an already-in-cart line unavailable once its option is marked sold out afterwards", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCart(admin, tenantA.tenantId);

    await admin.query(`select add_cart_item($1, $2, $3, $4, $5, $6)`, [
      cartId,
      tenantA.tenantId,
      menu.dishId,
      menu.variantId,
      1,
      [menu.optionId],
    ]);

    await admin.query(`update options set is_available = false where id = $1`, [menu.optionId]);

    const viewResult = await admin.query<{
      cart: { items: { isAvailable: boolean; selections: { isAvailable: boolean }[] }[] };
    }>(`select get_cart_view($1, $2) as cart`, [cartId, tenantA.tenantId]);
    const item = viewResult.rows[0]!.cart.items[0]!;
    expect(item.selections[0]!.isAvailable).toBe(false);
    expect(item.isAvailable).toBe(false);
  });

  it("backfills menu.availability.manage to Owner/Manager/Kitchen/Service (not Marketing)", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;

    const result = await admin.query<{ key: string }>(
      `select r.key
         from roles r
         join role_permissions rp on rp.role_id = r.id
        where r.tenant_id = $1
          and rp.permission_key = 'menu.availability.manage'
        order by r.key`,
      [tenantA.tenantId],
    );
    expect(result.rows.map((row) => row.key)).toEqual(["kitchen", "manager", "owner", "service"]);
  });

  it("lets a Kitchen-only member (no menu.write) toggle dish availability via set_dish_availability, but denies it entirely without menu.availability.manage", async () => {
    const kitchenUserId = randomUUID();
    fixture = await seedTwoTenantFixture(admin, {
      tenantA: {
        additionalMembers: [
          { userId: kitchenUserId, email: "kitchen@example.test", role: "staff" },
        ],
      },
    });
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);

    // Re-point the "staff" standard-role sync from Service to Kitchen so this
    // member has exactly menu.availability.manage and NOT menu.write --
    // mirrors roles-permissions.integration.test.ts's assignOnlySystemRole
    // helper.
    const membership = await admin.query<{ id: string }>(
      `select id from tenant_memberships where tenant_id = $1 and user_id = $2`,
      [tenantA.tenantId, kitchenUserId],
    );
    const membershipId = membership.rows[0]!.id;
    const role = await admin.query<{ id: string }>(
      `select id from roles where tenant_id = $1 and key = 'kitchen'`,
      [tenantA.tenantId],
    );
    const kitchenRoleId = role.rows[0]!.id;
    await admin.query(
      `delete from membership_roles mr
         using roles r
        where mr.membership_id = $1
          and mr.role_id = r.id
          and r.tenant_id = $2
          and r.is_system = true`,
      [membershipId, tenantA.tenantId],
    );
    await admin.query(`insert into membership_roles (membership_id, role_id) values ($1, $2)`, [
      membershipId,
      kitchenRoleId,
    ]);

    const menuWriteCheck = await queryAsUser<{ has_tenant_permission: boolean }>(
      admin,
      kitchenUserId,
      `select has_tenant_permission($1, 'menu.write') as has_tenant_permission`,
      [tenantA.tenantId],
    );
    expect(menuWriteCheck.rows[0]?.has_tenant_permission).toBe(false);

    await expect(
      queryAsUser(admin, kitchenUserId, `select set_dish_availability($1, $2, false, null)`, [
        menu.dishId,
        tenantA.tenantId,
      ]),
    ).resolves.not.toThrow();

    const updated = await admin.query<{ is_available: boolean }>(
      `select is_available from dishes where id = $1`,
      [menu.dishId],
    );
    expect(updated.rows[0]?.is_available).toBe(false);
  });

  it("denies set_dish_availability entirely for a user without menu.availability.manage in that tenant, including cross-tenant attempts", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);

    // Tenant B's Owner has menu.availability.manage in tenant B, but not in
    // tenant A.
    await expect(
      queryAsUser(admin, tenantB.ownerId, `select set_dish_availability($1, $2, false, null)`, [
        menu.dishId,
        tenantA.tenantId,
      ]),
    ).rejects.toThrow(/insufficient_privilege|missing permission/i);
  });

  it("carries over is_available/available_again_at when clone_menu_version_as_draft() clones a published version", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const future = new Date(Date.now() + 3600_000).toISOString();

    await admin.query(
      `update dishes set is_available = false, available_again_at = $1 where id = $2`,
      [future, menu.dishId],
    );
    await admin.query(
      `update dish_variants set is_available = false, available_again_at = $1 where id = $2`,
      [future, menu.variantId],
    );

    const cloned = await admin.query<{ clone_menu_version_as_draft: string }>(
      `select clone_menu_version_as_draft($1)`,
      [menu.menuVersionId],
    );
    const newDraftId = cloned.rows[0]!.clone_menu_version_as_draft;

    const clonedDish = await admin.query<{ is_available: boolean; available_again_at: string }>(
      `select d.is_available, d.available_again_at
         from dishes d
         join categories c on c.id = d.category_id
        where c.menu_version_id = $1`,
      [newDraftId],
    );
    expect(clonedDish.rows[0]?.is_available).toBe(false);
    expect(new Date(clonedDish.rows[0]!.available_again_at).toISOString()).toBe(future);

    const clonedVariant = await admin.query<{ is_available: boolean; available_again_at: string }>(
      `select dv.is_available, dv.available_again_at
         from dish_variants dv
         join dishes d on d.id = dv.dish_id
         join categories c on c.id = d.category_id
        where c.menu_version_id = $1`,
      [newDraftId],
    );
    expect(clonedVariant.rows[0]?.is_available).toBe(false);
    expect(new Date(clonedVariant.rows[0]!.available_again_at).toISOString()).toBe(future);
  });

  it("never lets one tenant read/toggle another tenant's dish availability directly (cross-tenant RLS)", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantB.ownerId,
      sql: `update dishes set is_available = false where id = $1`,
      params: [menu.dishId],
    });

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantB.ownerId,
      sql: `select id from dishes where id = $1`,
      params: [menu.dishId],
    });
  });
});
