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
    throw new Error(
      `[order-status-guest-lookup.integration.test] no reachable Postgres at ${DB_URL}.`,
    );
  }
  console.warn(
    `[order-status-guest-lookup.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

interface SeededMenu {
  menuVersionId: string;
  dishId: string;
  variantId: string;
  optionGroupId: string;
  cheapOptionId: string;
}

/** Seeds a minimal *published* menu (one dish, one variant, one option group) for `tenantId`. */
async function seedPublishedMenu(admin: Client, tenantId: string): Promise<SeededMenu> {
  const menuVersionId = randomUUID();
  const categoryId = randomUUID();
  const dishId = randomUUID();
  const variantId = randomUUID();
  const optionGroupId = randomUUID();
  const cheapOptionId = randomUUID();

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
    `insert into options (id, tenant_id, option_group_id, name, price_delta_cents) values ($1, $2, $3, 'Extra Käse', 150)`,
    [cheapOptionId, tenantId, optionGroupId],
  );
  await admin.query(
    `insert into dish_option_group_assignments (dish_id, option_group_id, tenant_id) values ($1, $2, $3)`,
    [dishId, optionGroupId, tenantId],
  );
  await admin.query(
    `update menu_versions set status = 'published', published_at = now() where id = $1`,
    [menuVersionId],
  );

  return { menuVersionId, dishId, variantId, optionGroupId, cheapOptionId };
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

/** Checks out `cartId`, returning both the created order and the raw guest access token that unlocks it. */
async function checkoutWithFreshToken(
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
): Promise<{ order: CreatedOrderRow; rawToken: string }> {
  const rawToken = randomUUID();
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
      hashToken(rawToken),
    ],
  );
  const order = result.rows[0]?.create_order_from_cart;
  if (!order) throw new Error("checkout failed in test setup");
  return { order, rawToken };
}

interface OrderStatusView {
  orderId: string;
  status: string;
  fulfillmentType: string;
  tableIdentifier: string | null;
  customerName: string;
  customerNote: string;
  totalCents: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    dishName: string;
    variantName: string | null;
    quantity: number;
    unitPriceCents: number;
    selections: Array<{ name: string; priceDeltaCents: number }>;
  }>;
  statusHistory: Array<{ status: string; occurredAt: string }>;
}

async function getOrderStatusByToken(
  admin: Client,
  rawToken: string,
): Promise<OrderStatusView | null> {
  const result = await admin.query<{ get_order_status_by_token: OrderStatusView | null }>(
    `select get_order_status_by_token($1) as get_order_status_by_token`,
    [hashToken(rawToken)],
  );
  return result.rows[0]?.get_order_status_by_token ?? null;
}

describe.skipIf(!dbAvailable)("get_order_status_by_token (ticket #22)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    if (fixture) {
      // orders.tenant_id is `on delete restrict` -- see orders-checkout.integration.test.ts's
      // identical cleanup rationale.
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

  it("returns the full customer-safe order view for a valid token", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCartWithItem(admin, tenantA.tenantId, menu, [menu.cheapOptionId]);
    const { order, rawToken } = await checkoutWithFreshToken(admin, cartId, tenantA.tenantId, {
      fulfillmentType: "table",
      tableIdentifier: "7",
      customerName: "Erika Musterfrau",
      customerNote: "Bitte klingeln",
    });

    const view = await getOrderStatusByToken(admin, rawToken);

    expect(view).not.toBeNull();
    expect(view!.orderId).toBe(order.orderId);
    expect(view!.status).toBe("awaiting_payment");
    expect(view!.fulfillmentType).toBe("table");
    expect(view!.tableIdentifier).toBe("7");
    expect(view!.customerName).toBe("Erika Musterfrau");
    expect(view!.customerNote).toBe("Bitte klingeln");
    expect(view!.totalCents).toBe(2700); // (1200 + 150) * 2
    expect(view!.currency).toBe("EUR");

    expect(view!.items).toHaveLength(1);
    const [item] = view!.items;
    expect(item).toMatchObject({
      dishName: "Margherita",
      variantName: "Groß",
      quantity: 2,
      unitPriceCents: 1200,
    });
    expect(item!.selections).toEqual([{ name: "Extra Käse", priceDeltaCents: 150 }]);

    expect(view!.statusHistory).toHaveLength(1);
    const [firstEvent] = view!.statusHistory;
    expect(firstEvent!.status).toBe("awaiting_payment");

    // Internal identifiers/fields are never part of the returned shape at all.
    expect(view).not.toHaveProperty("tenantId");
    expect(view).not.toHaveProperty("cartId");
    expect(view).not.toHaveProperty("guestAccessTokenHash");
  });

  it("never leaks staff-only fields (note/actor) from order_status_events", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCartWithItem(admin, tenantA.tenantId, menu);
    const { order, rawToken } = await checkoutWithFreshToken(admin, cartId, tenantA.tenantId);

    // Simulate a staff-driven transition carrying an internal note -- this
    // must never surface on the guest-facing status view (acceptance
    // criterion 2, "interne Notizen/Mitarbeiterinformationen werden nie
    // angezeigt").
    await admin.query(
      `insert into order_status_events (tenant_id, order_id, from_status, to_status, note)
       values ($1, $2, 'awaiting_payment', 'received', 'Kunde hat schon zweimal angerufen, genervt')`,
      [tenantA.tenantId, order.orderId],
    );

    const view = await getOrderStatusByToken(admin, rawToken);

    expect(view!.statusHistory).toHaveLength(2);
    for (const entry of view!.statusHistory) {
      expect(entry).not.toHaveProperty("note");
      expect(entry).not.toHaveProperty("actorUserId");
      expect(Object.keys(entry).sort()).toEqual(["occurredAt", "status"]);
    }
    expect(JSON.stringify(view)).not.toContain("genervt");
  });

  it("rejects a wrong/guessed token with the same null result as any other miss", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    const menu = await seedPublishedMenu(admin, tenantA.tenantId);
    const cartId = await createCartWithItem(admin, tenantA.tenantId, menu);
    await checkoutWithFreshToken(admin, cartId, tenantA.tenantId);

    const guessedToken = randomUUID();
    const view = await getOrderStatusByToken(admin, guessedToken);
    expect(view).toBeNull();

    // A malformed hash (not the RPC's expected 64-hex-char shape) is
    // rejected the same way -- no distinguishable error.
    const malformed = await admin.query(
      `select get_order_status_by_token($1) as get_order_status_by_token`,
      ["not-a-real-hash"],
    );
    expect(malformed.rows[0]?.get_order_status_by_token).toBeNull();
  });

  it("cross-tenant isolation: tenant B's guessed token never resolves tenant A's order, and tenant A's real token never returns tenant B data", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    const menuA = await seedPublishedMenu(admin, tenantA.tenantId);
    const menuB = await seedPublishedMenu(admin, tenantB.tenantId);

    const cartA = await createCartWithItem(admin, tenantA.tenantId, menuA);
    const { order: orderA, rawToken: tokenA } = await checkoutWithFreshToken(
      admin,
      cartA,
      tenantA.tenantId,
      { customerName: "Tenant A Gast" },
    );

    const cartB = await createCartWithItem(admin, tenantB.tenantId, menuB);
    const { order: orderB, rawToken: tokenB } = await checkoutWithFreshToken(
      admin,
      cartB,
      tenantB.tenantId,
      { customerName: "Tenant B Gast" },
    );

    // Tenant A's real token only ever resolves tenant A's own order.
    const viewA = await getOrderStatusByToken(admin, tokenA);
    expect(viewA!.orderId).toBe(orderA.orderId);
    expect(viewA!.customerName).toBe("Tenant A Gast");

    // Tenant B's real token only ever resolves tenant B's own order.
    const viewB = await getOrderStatusByToken(admin, tokenB);
    expect(viewB!.orderId).toBe(orderB.orderId);
    expect(viewB!.customerName).toBe("Tenant B Gast");

    // A token guessed/reused across tenants that doesn't actually match any
    // order's hash never resolves anything.
    const guessedCrossTenantToken = randomUUID();
    expect(await getOrderStatusByToken(admin, guessedCrossTenantToken)).toBeNull();
  });
});
