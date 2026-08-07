import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { seedTwoTenantFixture, type TwoTenantFixture } from "@gastro-saas/testing";

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
    throw new Error(`[cart-pricing.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(`[cart-pricing.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

interface SeededMenu {
  menuVersionId: string;
  categoryId: string;
  dishId: string;
  variantId: string;
  optionGroupId: string;
  cheapOptionId: string;
  extraOptionId: string;
}

/** Seeds a minimal *published* menu (one dish, one variant, one required option group) for `tenantId`. */
async function seedPublishedMenu(admin: Client, tenantId: string): Promise<SeededMenu> {
  const menuVersionId = randomUUID();
  const categoryId = randomUUID();
  const dishId = randomUUID();
  const variantId = randomUUID();
  const optionGroupId = randomUUID();
  const cheapOptionId = randomUUID();
  const extraOptionId = randomUUID();

  // Must be seeded as 'draft' first: ensure_menu_version_editable() (see
  // 20260801110000_restaurant_profile_and_menu_management.sql) blocks writes
  // to categories/dishes/variants/etc. once their menu version leaves draft
  // status, with no exemption for privileged connections -- only the
  // subsequent status flip to 'published' below is exempt (raw admin
  // connections aren't the 'authenticated'/'anon'/'service_role' app-facing
  // roles that guard_menu_versions_status_change() restricts).
  await admin.query(`insert into menu_versions (id, tenant_id, status) values ($1, $2, 'draft')`, [
    menuVersionId,
    tenantId,
  ]);
  await admin.query(
    `insert into categories (id, tenant_id, menu_version_id, name, sort_order) values ($1, $2, $3, 'Pizza', 1)`,
    [categoryId, tenantId, menuVersionId],
  );
  await admin.query(
    `insert into dishes (id, tenant_id, menu_version_id, category_id, name, allergen_reviewed)
     values ($1, $2, $3, $4, 'Margherita', true)`,
    [dishId, tenantId, menuVersionId, categoryId],
  );
  await admin.query(
    `insert into dish_variants (id, tenant_id, dish_id, name, price_cents, is_available)
     values ($1, $2, $3, 'Groß', 1200, true)`,
    [variantId, tenantId, dishId],
  );
  await admin.query(
    `insert into option_groups (id, tenant_id, name, min_selections, max_selections)
     values ($1, $2, 'Extras', 0, 2)`,
    [optionGroupId, tenantId],
  );
  await admin.query(
    `insert into options (id, tenant_id, option_group_id, name, price_delta_cents) values
       ($1, $3, $4, 'Extra Käse', 150),
       ($2, $3, $4, 'Oliven', 100)`,
    [cheapOptionId, extraOptionId, tenantId, optionGroupId],
  );
  await admin.query(
    `insert into dish_option_group_assignments (dish_id, option_group_id, tenant_id) values ($1, $2, $3)`,
    [dishId, optionGroupId, tenantId],
  );
  await admin.query(
    `update menu_versions set status = 'published', published_at = now() where id = $1`,
    [menuVersionId],
  );

  return {
    menuVersionId,
    categoryId,
    dishId,
    variantId,
    optionGroupId,
    cheapOptionId,
    extraOptionId,
  };
}

async function createCart(admin: Client, tenantId: string): Promise<string> {
  const token = randomUUID();
  const result = await admin.query<{ get_or_create_cart: string }>(
    `select get_or_create_cart($1, $2) as get_or_create_cart`,
    [tenantId, hashToken(token)],
  );
  const cartId = result.rows[0]?.get_or_create_cart;
  if (!cartId) throw new Error("failed to create cart in test setup");
  return cartId;
}

describe.skipIf(!dbAvailable)("cart server-side pricing (ticket #20)", () => {
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

  it("recalculates the total from live prices on every read -- never a stale/stored value", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCart(admin, tenantA.tenantId);

    const addResult = await admin.query(`select add_cart_item($1, $2, $3, $4, $5, $6) as cart`, [
      cartId,
      tenantA.tenantId,
      menu.dishId,
      menu.variantId,
      2,
      [menu.cheapOptionId, menu.extraOptionId],
    ]);
    const firstCart = addResult.rows[0].cart;
    // (1200 variant + 150 + 100 extras) * 2 = 2900
    expect(firstCart.totalCents).toBe(2900);
    expect(firstCart.checkoutReady).toBe(true);
    expect(firstCart.items[0].isAvailable).toBe(true);

    // The menu price changes after the item was added (e.g. the restaurant
    // raises the variant price) -- the *next* read must reflect the new
    // price, proving the total is never cached/trusted from add-time.
    await admin.query(`update dish_variants set price_cents = 1500 where id = $1`, [
      menu.variantId,
    ]);

    const viewResult = await admin.query(`select get_cart_view($1, $2) as cart`, [
      cartId,
      tenantA.tenantId,
    ]);
    const refreshedCart = viewResult.rows[0].cart;
    // (1500 + 150 + 100) * 2 = 3500
    expect(refreshedCart.totalCents).toBe(3500);
  });

  it("rejects adding an already sold-out/unavailable variant", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCart(admin, tenantA.tenantId);

    await admin.query(`update dish_variants set is_available = false where id = $1`, [
      menu.variantId,
    ]);

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

  it("flags a product that becomes sold out after being added, excludes it from the total, and blocks checkout", async () => {
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
      [],
    ]);

    // The restaurant marks the variant sold out while it sits in the cart.
    await admin.query(`update dish_variants set is_available = false where id = $1`, [
      menu.variantId,
    ]);

    const viewResult = await admin.query(`select get_cart_view($1, $2) as cart`, [
      cartId,
      tenantA.tenantId,
    ]);
    const cart = viewResult.rows[0].cart;

    expect(cart.items[0].isAvailable).toBe(false);
    expect(cart.items[0].lineTotalCents).toBe(0);
    expect(cart.totalCents).toBe(0);
    expect(cart.hasUnavailableItems).toBe(true);
    expect(cart.checkoutReady).toBe(false);
  });

  it("flags a dish removed from the currently published menu version (re-published without it)", async () => {
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
      [],
    ]);

    // Simulates the restaurant publishing a new menu version that no longer
    // includes this dish: the old published version is archived and a new
    // (empty) one takes over.
    await admin.query(`update menu_versions set status = 'archived' where id = $1`, [
      menu.menuVersionId,
    ]);
    const newVersionId = randomUUID();
    await admin.query(
      `insert into menu_versions (id, tenant_id, status, published_at) values ($1, $2, 'published', now())`,
      [newVersionId, tenantA.tenantId],
    );

    const viewResult = await admin.query(`select get_cart_view($1, $2) as cart`, [
      cartId,
      tenantA.tenantId,
    ]);
    const cart = viewResult.rows[0].cart;

    expect(cart.items[0].isAvailable).toBe(false);
    expect(cart.checkoutReady).toBe(false);
  });

  it("never leaks or lets one tenant's guest cart be read/mutated via another tenant's id (cross-tenant isolation)", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartAId = await createCart(admin, tenantA.tenantId);

    await admin.query(`select add_cart_item($1, $2, $3, $4, $5, $6)`, [
      cartAId,
      tenantA.tenantId,
      menu.dishId,
      menu.variantId,
      1,
      [],
    ]);

    // Reading tenant A's cart while claiming to be tenant B is rejected.
    await expect(
      admin.query(`select get_cart_view($1, $2)`, [cartAId, tenantB.tenantId]),
    ).rejects.toThrow(/cart not found/i);

    // Mutating tenant A's cart while claiming to be tenant B is rejected.
    await expect(
      admin.query(`select add_cart_item($1, $2, $3, $4, $5, $6)`, [
        cartAId,
        tenantB.tenantId,
        menu.dishId,
        menu.variantId,
        1,
        [],
      ]),
    ).rejects.toThrow(/cart not found/i);

    const cartItemsResult = await admin.query<{ id: string }>(
      `select id from cart_items where cart_id = $1`,
      [cartAId],
    );
    const cartItemId = cartItemsResult.rows[0]?.id;

    await expect(
      admin.query(`select remove_cart_item($1, $2, $3)`, [cartAId, tenantB.tenantId, cartItemId]),
    ).rejects.toThrow(/cart not found/i);

    // A guest token already bound to tenant A's cart can never resolve to a
    // cart under tenant B, even if the same hash were (implausibly) reused.
    const token = randomUUID();
    const tokenHash = hashToken(token);
    await admin.query(`select get_or_create_cart($1, $2)`, [tenantA.tenantId, tokenHash]);
    await expect(
      admin.query(`select get_or_create_cart($1, $2)`, [tenantB.tenantId, tokenHash]),
    ).rejects.toThrow(/duplicate key|unique/i);

    // Direct cross-tenant row insertion (bypassing the RPCs) is rejected by
    // the tenant-match trigger, matching the established
    // ensure_menu_child_tenant_match()/ensure_assignment_tenant_match() guard
    // pattern in 20260801110000_restaurant_profile_and_menu_management.sql.
    await expect(
      admin.query(
        `insert into cart_items (tenant_id, cart_id, dish_id, quantity, dish_name_snapshot)
         values ($1, $2, $3, 1, 'x')`,
        [tenantB.tenantId, cartAId, menu.dishId],
      ),
    ).rejects.toThrow(/tenant_id must match/i);
  });
});
