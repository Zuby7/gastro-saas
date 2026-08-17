// Integration tests for `get_dish_performance_stats()` (ticket #31, Epic 9
// "Topseller- und Low-Performer-Analyse"). Same DB-probe/skip pattern as the
// other database integration suites.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { queryAsUser, seedTwoTenantFixture, type TwoTenantFixture } from "@gastro-saas/testing";

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
      `[dish-performance-stats.integration.test] no reachable Postgres at ${DB_URL}.`,
    );
  }
  console.warn(
    `[dish-performance-stats.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

interface SeededMenu {
  menuVersionId: string;
  categoryId: string;
  dishIds: string[];
}

interface DishSpec {
  name: string;
  /** Archived while the menu version is still draft, then the version is published (dishes.* is read-only once a menu version leaves 'draft', so archiving must happen before publish). */
  archived?: boolean;
}

/**
 * Seeds a single published menu version with one category and one dish per
 * `dishSpecs` entry -- all dishes are created (and any archival applied)
 * while the menu version is still in `draft` status, then the version is
 * published in one final step, since `dishes` is read-only (INSERT/UPDATE/
 * DELETE all blocked) once its menu version leaves `draft`
 * (`ensure_menu_version_editable()`).
 */
async function seedPublishedMenu(
  admin: Client,
  tenantId: string,
  dishSpecs: DishSpec[],
): Promise<SeededMenu> {
  const menuVersionId = randomUUID();
  const categoryId = randomUUID();

  await admin.query(`insert into menu_versions (id, tenant_id, status) values ($1, $2, 'draft')`, [
    menuVersionId,
    tenantId,
  ]);
  await admin.query(
    `insert into categories (id, tenant_id, menu_version_id, name, sort_order) values ($1, $2, $3, 'Pizza', 1)`,
    [categoryId, tenantId, menuVersionId],
  );

  const dishIds: string[] = [];
  for (const spec of dishSpecs) {
    const dishId = randomUUID();
    await admin.query(
      `insert into dishes (id, tenant_id, menu_version_id, category_id, name, price_cents, allergen_reviewed)
       values ($1, $2, $3, $4, $5, 1000, true)`,
      [dishId, tenantId, menuVersionId, categoryId, spec.name],
    );
    if (spec.archived) {
      await admin.query(`update dishes set archived_at = now() where id = $1`, [dishId]);
    }
    dishIds.push(dishId);
  }

  await admin.query(
    `update menu_versions set status = 'published', published_at = now() where id = $1`,
    [menuVersionId],
  );

  return { menuVersionId, categoryId, dishIds };
}

interface SeedOrderItemInput {
  dishId: string;
  quantity: number;
  unitPriceCentsSnapshot: number;
  dishName: string;
}

/** Seeds an order (walking the real state machine to `status`) with order_items for `items`, bypassing the cart/checkout flow (out of this ticket's scope). */
async function seedOrderWithItems(
  admin: Client,
  tenantId: string,
  items: SeedOrderItemInput[],
  options: { status?: string; createdAt?: Date } = {},
): Promise<string> {
  const orderId = randomUUID();
  const token = randomUUID();
  const tokenHash = Buffer.from(token).toString("hex").padEnd(64, "0").slice(0, 64);
  const totalCents = items.reduce((sum, i) => sum + i.quantity * i.unitPriceCentsSnapshot, 0);

  await admin.query(
    `insert into orders (id, tenant_id, guest_access_token_hash, fulfillment_type, customer_name, currency, total_cents, created_at)
     values ($1, $2, $3, 'pickup', 'Max Mustermann', 'EUR', $4, $5)`,
    [orderId, tenantId, tokenHash, totalCents, (options.createdAt ?? new Date()).toISOString()],
  );

  for (const item of items) {
    await admin.query(
      `insert into order_items (tenant_id, order_id, dish_id, quantity, dish_name_snapshot, unit_price_cents_snapshot, currency)
       values ($1, $2, $3, $4, $5, $6, 'EUR')`,
      [tenantId, orderId, item.dishId, item.quantity, item.dishName, item.unitPriceCentsSnapshot],
    );
  }

  await admin.query(
    `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, null, 'awaiting_payment')`,
    [tenantId, orderId],
  );

  const path = ["received", "accepted", "preparing", "ready", "completed"] as const;
  const status = options.status ?? "awaiting_payment";
  if (status === "cancelled") {
    await admin.query(
      `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, 'awaiting_payment', 'cancelled')`,
      [tenantId, orderId],
    );
  } else {
    const targetIndex = path.indexOf(status as (typeof path)[number]);
    if (targetIndex >= 0) {
      let fromStatus = "awaiting_payment";
      for (let i = 0; i <= targetIndex; i += 1) {
        const toStatus = path[i]!;
        await admin.query(
          `insert into order_status_events (tenant_id, order_id, from_status, to_status) values ($1, $2, $3, $4)`,
          [tenantId, orderId, fromStatus, toStatus],
        );
        fromStatus = toStatus;
      }
    }
  }

  return orderId;
}

describe.skipIf(!dbAvailable)("get_dish_performance_stats() (ticket #31)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    if (fixture) {
      // orders.tenant_id is `on delete restrict` (refunds/analytics-dashboard
      // suites' precedent) -- deleting `orders` cascades to order_items/
      // order_status_events. dishes/categories/menu_versions are intentionally
      // NOT manually deleted here: they cascade fine when the fixture's own
      // cleanup() deletes the tenants below (same as
      // orders-checkout.integration.test.ts/menu-management.integration.test.ts) --
      // manually deleting them first would hit
      // ensure_menu_version_editable()'s "read-only once published" guard,
      // since at that point the menu_versions row (status='published') still
      // exists; that guard only stays out of the way once the referencing
      // menu_versions row itself has already been removed by the same
      // cascading tenant delete.
      await admin.query(`delete from analytics_events where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
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

  async function seedFixtureWithManager(): Promise<{
    fixture: TwoTenantFixture;
    managerId: string;
    staffId: string;
  }> {
    const managerId = randomUUID();
    const staffId = randomUUID();
    const seeded = await seedTwoTenantFixture(admin, {
      tenantA: { additionalMembers: [{ userId: managerId, role: "manager" }] },
      tenantB: { additionalMembers: [{ userId: staffId, role: "staff" }] },
    });
    return { fixture: seeded, managerId, staffId };
  }

  async function getStats(
    actorUserId: string,
    tenantId: string,
    daysBack?: number,
  ): Promise<Array<Record<string, unknown>>> {
    const result =
      daysBack !== undefined
        ? await queryAsUser(
            admin,
            actorUserId,
            `select get_dish_performance_stats($1, $2) as stats`,
            [tenantId, daysBack],
          )
        : await queryAsUser(admin, actorUserId, `select get_dish_performance_stats($1) as stats`, [
            tenantId,
          ]);
    return result.rows[0]!.stats as Array<Record<string, unknown>>;
  }

  it("computes units sold / revenue from paid order items, honestly reporting zero for a dish with no sales", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { dishIds } = await seedPublishedMenu(admin, fixture.tenantA.tenantId, [
      { name: "Margherita" },
      { name: "Quattro Stagioni" },
    ]);
    const [dishId, unsoldDishId] = dishIds as [string, string];

    await seedOrderWithItems(
      admin,
      fixture.tenantA.tenantId,
      [{ dishId, quantity: 3, unitPriceCentsSnapshot: 1000, dishName: "Margherita" }],
      { status: "completed" },
    );

    const stats = await getStats(seed.managerId, fixture.tenantA.tenantId);
    const margherita = stats.find((s) => s.dishId === dishId)!;
    const unsold = stats.find((s) => s.dishId === unsoldDishId)!;

    expect(margherita.unitsSold).toBe(3);
    expect(margherita.revenueCents).toBe(3000);
    expect(unsold.unitsSold).toBe(0);
    expect(unsold.revenueCents).toBe(0);
    expect(unsold.viewsCount).toBe(0);
    expect(unsold.addToCartCount).toBe(0);
  });

  it("excludes orders still awaiting_payment or cancelled -- those never counted as a real sale", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { dishIds } = await seedPublishedMenu(admin, fixture.tenantA.tenantId, [
      { name: "Margherita" },
    ]);
    const dishId = dishIds[0]!;

    await seedOrderWithItems(
      admin,
      fixture.tenantA.tenantId,
      [{ dishId, quantity: 5, unitPriceCentsSnapshot: 1000, dishName: "Margherita" }],
      { status: "awaiting_payment" },
    );
    await seedOrderWithItems(
      admin,
      fixture.tenantA.tenantId,
      [{ dishId, quantity: 7, unitPriceCentsSnapshot: 1000, dishName: "Margherita" }],
      { status: "cancelled" },
    );
    await seedOrderWithItems(
      admin,
      fixture.tenantA.tenantId,
      [{ dishId, quantity: 2, unitPriceCentsSnapshot: 1000, dishName: "Margherita" }],
      { status: "received" },
    );

    const stats = await getStats(seed.managerId, fixture.tenantA.tenantId);
    expect(stats.find((s) => s.dishId === dishId)!.unitsSold).toBe(2);
  });

  it("only considers the tenant's currently published menu's non-archived dishes", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { dishIds } = await seedPublishedMenu(admin, fixture.tenantA.tenantId, [
      { name: "Margherita" },
      { name: "Archiviert", archived: true },
    ]);
    const [dishId, archivedDishId] = dishIds as [string, string];

    const stats = await getStats(seed.managerId, fixture.tenantA.tenantId);
    expect(stats.some((s) => s.dishId === archivedDishId)).toBe(false);
    expect(stats.some((s) => s.dishId === dishId)).toBe(true);
  });

  it("only reports order items within the p_days_back window", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { dishIds } = await seedPublishedMenu(admin, fixture.tenantA.tenantId, [
      { name: "Margherita" },
    ]);
    const dishId = dishIds[0]!;

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 60);
    await seedOrderWithItems(
      admin,
      fixture.tenantA.tenantId,
      [{ dishId, quantity: 10, unitPriceCentsSnapshot: 1000, dishName: "Margherita" }],
      { status: "completed", createdAt: oldDate },
    );
    await seedOrderWithItems(
      admin,
      fixture.tenantA.tenantId,
      [{ dishId, quantity: 1, unitPriceCentsSnapshot: 1000, dishName: "Margherita" }],
      { status: "completed" },
    );

    const stats30Days = await getStats(seed.managerId, fixture.tenantA.tenantId, 30);
    expect(stats30Days.find((s) => s.dishId === dishId)!.unitsSold).toBe(1);

    const stats90Days = await getStats(seed.managerId, fixture.tenantA.tenantId, 90);
    expect(stats90Days.find((s) => s.dishId === dishId)!.unitsSold).toBe(11);
  });

  it("counts dish_view/add_to_cart analytics_events for the dish (read side is ready even though nothing writes them yet)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { dishIds } = await seedPublishedMenu(admin, fixture.tenantA.tenantId, [
      { name: "Margherita" },
    ]);
    const dishId = dishIds[0]!;

    await admin.query(
      `insert into analytics_events (tenant_id, event_type, dish_id) values
         ($1, 'dish_view', $2), ($1, 'dish_view', $2), ($1, 'add_to_cart', $2)`,
      [fixture.tenantA.tenantId, dishId],
    );

    const stats = await getStats(seed.managerId, fixture.tenantA.tenantId);
    const dish = stats.find((s) => s.dishId === dishId)!;
    expect(dish.viewsCount).toBe(2);
    expect(dish.addToCartCount).toBe(1);
  });

  it("returns an empty array when the tenant has no published menu (honest empty state)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;

    const stats = await getStats(seed.managerId, fixture.tenantA.tenantId);
    expect(stats).toEqual([]);
  });

  it("rejects a non-positive p_days_back", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;

    await expect(getStats(seed.managerId, fixture.tenantA.tenantId, 0)).rejects.toThrow(
      /p_days_back must be a positive integer/i,
    );
  });

  it("denies a member without analytics.read (permission-denied case)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;

    await expect(getStats(seed.staffId, fixture.tenantB.tenantId)).rejects.toThrow(
      /insufficient_privilege|permission/i,
    );
  });

  it("never leaks another tenant's dish performance via a client-supplied tenant_id (cross-tenant isolation)", async () => {
    const seed = await seedFixtureWithManager();
    fixture = seed.fixture;
    const { dishIds } = await seedPublishedMenu(admin, fixture.tenantB.tenantId, [
      { name: "Geheimgericht" },
    ]);
    const dishId = dishIds[0]!;
    await seedOrderWithItems(
      admin,
      fixture.tenantB.tenantId,
      [{ dishId, quantity: 15, unitPriceCentsSnapshot: 1000, dishName: "Geheimgericht" }],
      { status: "completed" },
    );

    // seed.managerId holds analytics.read only in tenantA -- must not read tenantB's stats.
    await expect(getStats(seed.managerId, fixture.tenantB.tenantId)).rejects.toThrow(
      /insufficient_privilege|permission/i,
    );

    // Sanity check: tenantB's own owner (analytics.read via the Owner role) can see it.
    const stats = await getStats(fixture.tenantB.ownerId, fixture.tenantB.tenantId);
    expect(stats.find((s) => s.dishId === dishId)!.unitsSold).toBe(15);
  });
});
