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
    throw new Error(`[orders-checkout.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(`[orders-checkout.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function guestAccessTokenHash(): string {
  return hashToken(randomUUID());
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

async function createCartWithItem(
  admin: Client,
  tenantId: string,
  menu: SeededMenu,
  optionIds: string[] = [],
): Promise<string> {
  const token = randomUUID();
  const cartResult = await admin.query<{ get_or_create_cart: string }>(
    `select get_or_create_cart($1, $2) as get_or_create_cart`,
    [tenantId, hashToken(token)],
  );
  const cartId = cartResult.rows[0]?.get_or_create_cart;
  if (!cartId) throw new Error("failed to create cart in test setup");

  await admin.query(`select add_cart_item($1, $2, $3, $4, $5, $6)`, [
    cartId,
    tenantId,
    menu.dishId,
    menu.variantId,
    2,
    optionIds,
  ]);

  return cartId;
}

interface CreatedOrderRow {
  orderId: string;
  status: string;
  totalCents: number;
  currency: string;
}

async function checkout(
  admin: Client,
  cartId: string,
  tenantId: string,
  overrides: Partial<{
    fulfillmentType: string;
    customerName: string;
    customerPhone: string | null;
    tableIdentifier: string | null;
    customerNote: string;
  }> = {},
): Promise<CreatedOrderRow> {
  const result = await admin.query<{ create_order_from_cart: CreatedOrderRow }>(
    `select create_order_from_cart($1, $2, $3, $4, $5, $6, $7, $8) as create_order_from_cart`,
    [
      cartId,
      tenantId,
      overrides.fulfillmentType ?? "pickup",
      overrides.customerName ?? "Max Mustermann",
      overrides.customerPhone ?? null,
      overrides.tableIdentifier ?? null,
      overrides.customerNote ?? "",
      guestAccessTokenHash(),
    ],
  );
  const row = result.rows[0]?.create_order_from_cart;
  if (!row) throw new Error("checkout failed in test setup");
  return row;
}

describe.skipIf(!dbAvailable)("orders: state machine + checkout (ticket #21)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    if (fixture) {
      // orders.tenant_id is `on delete restrict` (mirrors audit_logs'
      // precedent -- a tenant with order history can never be deleted
      // implicitly), so any order created by a test must be explicitly
      // removed before the fixture's own cleanup() deletes its tenants.
      // Deleting `orders` cascades to order_items/order_item_selections/
      // order_status_events.
      await admin.query(`delete from orders where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
    }
    await fixture?.cleanup();
  });

  afterAll(async () => {
    await admin.end();
  });

  it("creates an awaiting_payment order with a snapshot of every cart line, and clears the cart", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCartWithItem(admin, tenantA.tenantId, menu, [menu.cheapOptionId]);

    const order = await checkout(admin, cartId, tenantA.tenantId, { fulfillmentType: "pickup" });

    expect(order.status).toBe("awaiting_payment");
    // (1200 variant + 150 extra) * 2 = 2700
    expect(order.totalCents).toBe(2700);

    const orderRow = await admin.query(`select status, total_cents, fulfillment_type from orders where id = $1`, [
      order.orderId,
    ]);
    expect(orderRow.rows[0].status).toBe("awaiting_payment");
    expect(orderRow.rows[0].total_cents).toBe(2700);
    expect(orderRow.rows[0].fulfillment_type).toBe("pickup");

    const itemsRow = await admin.query(
      `select dish_name_snapshot, variant_name_snapshot, unit_price_cents_snapshot, quantity from order_items where order_id = $1`,
      [order.orderId],
    );
    expect(itemsRow.rows).toHaveLength(1);
    expect(itemsRow.rows[0].dish_name_snapshot).toBe("Margherita");
    expect(itemsRow.rows[0].variant_name_snapshot).toBe("Groß");
    expect(itemsRow.rows[0].unit_price_cents_snapshot).toBe(1200);
    expect(itemsRow.rows[0].quantity).toBe(2);

    const selectionsRow = await admin.query(
      `select option_name_snapshot, price_delta_cents_snapshot from order_item_selections`,
    );
    expect(selectionsRow.rows).toHaveLength(1);
    expect(selectionsRow.rows[0].option_name_snapshot).toBe("Extra Käse");
    expect(selectionsRow.rows[0].price_delta_cents_snapshot).toBe(150);

    const initialEvent = await admin.query(
      `select from_status, to_status from order_status_events where order_id = $1`,
      [order.orderId],
    );
    expect(initialEvent.rows).toHaveLength(1);
    expect(initialEvent.rows[0].from_status).toBeNull();
    expect(initialEvent.rows[0].to_status).toBe("awaiting_payment");

    const cartItemsRow = await admin.query(`select id from cart_items where cart_id = $1`, [cartId]);
    expect(cartItemsRow.rows).toHaveLength(0);
  });

  it("snapshot immutability: later menu edits never change an already-created order", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCartWithItem(admin, tenantA.tenantId, menu, [menu.cheapOptionId]);

    const order = await checkout(admin, cartId, tenantA.tenantId);

    // The restaurant renames the dish, changes the variant price, and
    // raises the option's price delta *after* the order was created.
    await admin.query(`update dishes set name = 'Margherita Deluxe' where id = $1`, [menu.dishId]);
    await admin.query(`update dish_variants set price_cents = 5000 where id = $1`, [menu.variantId]);
    await admin.query(`update options set name = 'XL Käse', price_delta_cents = 999 where id = $1`, [
      menu.cheapOptionId,
    ]);

    const orderRow = await admin.query(`select total_cents from orders where id = $1`, [order.orderId]);
    expect(orderRow.rows[0].total_cents).toBe(2700);

    const itemsRow = await admin.query(
      `select dish_name_snapshot, unit_price_cents_snapshot from order_items where order_id = $1`,
      [order.orderId],
    );
    expect(itemsRow.rows[0].dish_name_snapshot).toBe("Margherita");
    expect(itemsRow.rows[0].unit_price_cents_snapshot).toBe(1200);

    const selectionsRow = await admin.query(
      `select option_name_snapshot, price_delta_cents_snapshot from order_item_selections`,
    );
    expect(selectionsRow.rows[0].option_name_snapshot).toBe("Extra Käse");
    expect(selectionsRow.rows[0].price_delta_cents_snapshot).toBe(150);

    // Even archiving the dish entirely must not touch the historical order.
    await admin.query(`update dishes set archived_at = now() where id = $1`, [menu.dishId]);
    const afterArchive = await admin.query(
      `select unit_price_cents_snapshot from order_items where order_id = $1`,
      [order.orderId],
    );
    expect(afterArchive.rows[0].unit_price_cents_snapshot).toBe(1200);

    // Direct attempts to mutate the immutable snapshot rows, from an
    // app-facing role, are rejected outright. `order_items`/
    // `order_item_selections` grant only SELECT/INSERT to `service_role` (no
    // UPDATE/DELETE at all -- see the migration's GRANTs), so Postgres'
    // own privilege system denies this before the row-level immutability
    // trigger even runs; the trigger is defense-in-depth for any future,
    // more permissive GRANT. A bare superuser connection (this test's
    // `admin` client, with no `SET ROLE`) is a "non-app-facing" caller by
    // this migration's own convention and is intentionally NOT restricted
    // (mirroring `audit_logs`' precedent) -- so these assertions must run as
    // `service_role` to actually exercise the guarantee a real request path
    // is bound by.
    await admin.query("set role service_role");
    try {
      await expect(
        admin.query(`update order_items set unit_price_cents_snapshot = 1 where order_id = $1`, [
          order.orderId,
        ]),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        admin.query(`delete from order_items where order_id = $1`, [order.orderId]),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        admin.query(`update order_item_selections set price_delta_cents_snapshot = 1`),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await admin.query("reset role");
    }
  });

  it("rejects checkout when the cart is empty or not ready", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);

    const emptyCartToken = randomUUID();
    const emptyCartResult = await admin.query<{ get_or_create_cart: string }>(
      `select get_or_create_cart($1, $2) as get_or_create_cart`,
      [tenantA.tenantId, hashToken(emptyCartToken)],
    );
    const emptyCartId = emptyCartResult.rows[0]?.get_or_create_cart;

    await expect(checkout(admin, emptyCartId!, tenantA.tenantId)).rejects.toThrow(/cart is empty/i);

    const unavailableCartId = await createCartWithItem(admin, tenantA.tenantId, menu);
    await admin.query(`update dish_variants set is_available = false where id = $1`, [menu.variantId]);

    await expect(checkout(admin, unavailableCartId, tenantA.tenantId)).rejects.toThrow(
      /not ready for checkout/i,
    );
  });

  it("checkout requires only the fields the chosen fulfillment type needs", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);

    const pickupCartId = await createCartWithItem(admin, tenantA.tenantId, menu);
    const pickupOrder = await checkout(admin, pickupCartId, tenantA.tenantId, {
      fulfillmentType: "pickup",
    });
    const pickupRow = await admin.query(`select table_identifier from orders where id = $1`, [
      pickupOrder.orderId,
    ]);
    expect(pickupRow.rows[0].table_identifier).toBeNull();

    const tableCartIdMissing = await createCartWithItem(admin, tenantA.tenantId, menu);
    await expect(
      checkout(admin, tableCartIdMissing, tenantA.tenantId, { fulfillmentType: "table" }),
    ).rejects.toThrow(/table identifier is required/i);

    const tableCartId = await createCartWithItem(admin, tenantA.tenantId, menu);
    const tableOrder = await checkout(admin, tableCartId, tenantA.tenantId, {
      fulfillmentType: "table",
      tableIdentifier: "12",
    });
    const tableRow = await admin.query(`select table_identifier from orders where id = $1`, [
      tableOrder.orderId,
    ]);
    expect(tableRow.rows[0].table_identifier).toBe("12");

    const deliveryCartId = await createCartWithItem(admin, tenantA.tenantId, menu);
    await expect(
      checkout(admin, deliveryCartId, tenantA.tenantId, { fulfillmentType: "delivery" }),
    ).rejects.toThrow(/not yet supported/i);
  });

  it("state machine: rejects invalid transitions and enforces the documented order", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCartWithItem(admin, tenantA.tenantId, menu);
    const order = await checkout(admin, cartId, tenantA.tenantId);

    // Skipping a step is rejected.
    await expect(
      admin.query(
        `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, 'awaiting_payment', 'preparing')`,
        [tenantA.tenantId, order.orderId],
      ),
    ).rejects.toThrow(/invalid order status transition/i);

    // A from_status that doesn't match the order's real current status is rejected.
    await expect(
      admin.query(
        `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, 'ready', 'completed')`,
        [tenantA.tenantId, order.orderId],
      ),
    ).rejects.toThrow(/does not match the order/i);

    // The happy path is accepted step by step, and orders.status is kept in sync.
    for (const [from, to] of [
      ["awaiting_payment", "received"],
      ["received", "accepted"],
      ["accepted", "preparing"],
      ["preparing", "ready"],
      ["ready", "completed"],
    ]) {
      await admin.query(
        `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, $3, $4)`,
        [tenantA.tenantId, order.orderId, from, to],
      );
      const statusRow = await admin.query(`select status from orders where id = $1`, [order.orderId]);
      expect(statusRow.rows[0].status).toBe(to);
    }

    // completed is terminal -- no further transition, including cancellation, is valid.
    await expect(
      admin.query(
        `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, 'completed', 'cancelled')`,
        [tenantA.tenantId, order.orderId],
      ),
    ).rejects.toThrow(/invalid order status transition/i);

    // Direct UPDATEs to orders.status, bypassing order_status_events
    // entirely, are rejected -- `orders` (unlike order_items/
    // order_status_events) does grant UPDATE to `service_role` (needed for
    // sync_order_status_from_event()'s own sanctioned write), so this must
    // run as `service_role` to actually exercise
    // `guard_orders_status_change()`'s allow-flag check rather than being
    // short-circuited by a missing GRANT.
    await admin.query("set role service_role");
    try {
      await expect(
        admin.query(`update orders set status = 'cancelled' where id = $1`, [order.orderId]),
      ).rejects.toThrow(/can only be changed by appending/i);
    } finally {
      await admin.query("reset role");
    }
  });

  it("allows cancellation from an early state but not once ready", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);

    const cartId = await createCartWithItem(admin, tenantA.tenantId, menu);
    const order = await checkout(admin, cartId, tenantA.tenantId);

    await admin.query(
      `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, 'awaiting_payment', 'cancelled')`,
      [tenantA.tenantId, order.orderId],
    );
    const statusRow = await admin.query(`select status from orders where id = $1`, [order.orderId]);
    expect(statusRow.rows[0].status).toBe("cancelled");

    // cancelled is terminal.
    await expect(
      admin.query(
        `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, 'cancelled', 'received')`,
        [tenantA.tenantId, order.orderId],
      ),
    ).rejects.toThrow(/invalid order status transition/i);
  });

  it("never leaks or lets one tenant's order be read/checked-out via another tenant's id (cross-tenant isolation)", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCartWithItem(admin, tenantA.tenantId, menu);

    // Checking out tenant A's cart while claiming to be tenant B is rejected.
    await expect(checkout(admin, cartId, tenantB.tenantId)).rejects.toThrow(/cart not found/i);

    const order = await checkout(admin, cartId, tenantA.tenantId);

    // Direct cross-tenant row insertion (bypassing the RPC) is rejected by the tenant-match trigger.
    await expect(
      admin.query(
        `insert into order_items (tenant_id, order_id, quantity, dish_name_snapshot, unit_price_cents_snapshot)
         values ($1, $2, 1, 'x', 100)`,
        [tenantB.tenantId, order.orderId],
      ),
    ).rejects.toThrow(/tenant_id must match/i);

    await expect(
      admin.query(
        `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, 'awaiting_payment', 'received')`,
        [tenantB.tenantId, order.orderId],
      ),
    ).rejects.toThrow(/tenant_id must match/i);

    // A guest access token hash bound to tenant A's order can never collide/leak into tenant B's data.
    const orderCountForB = await admin.query(`select count(*)::int as count from orders where tenant_id = $1`, [
      tenantB.tenantId,
    ]);
    expect(orderCountForB.rows[0].count).toBe(0);
  });
});
