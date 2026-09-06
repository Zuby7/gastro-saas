// Integration tests for `manual_sales_entries` and its analytics integration
// (ticket #58, Epic 9 follow-up "Manuelle Nacherfassung von Verkäufen").
// Same DB-probe/skip pattern as the other database integration suites.
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
    throw new Error(`[manual-sales-entries.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(
    `[manual-sales-entries.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

/** Seeds a single published menu version with one category and one dish. Mirrors dish-performance-stats.integration.test.ts's own helper. */
async function seedPublishedDish(
  admin: Client,
  tenantId: string,
  options: { name?: string; priceCents?: number } = {},
): Promise<string> {
  const menuVersionId = randomUUID();
  const categoryId = randomUUID();
  const dishId = randomUUID();

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
     values ($1, $2, $3, $4, $5, $6, true)`,
    [dishId, tenantId, menuVersionId, categoryId, options.name ?? "Margherita", options.priceCents ?? 1000],
  );
  await admin.query(
    `update menu_versions set status = 'published', published_at = now() where id = $1`,
    [menuVersionId],
  );

  return dishId;
}

describe.skipIf(!dbAvailable)("manual_sales_entries (ticket #58)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    if (fixture) {
      await admin.query(`delete from manual_sales_entries where tenant_id in ($1, $2)`, [
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

  async function seedFixtureWithManagerAndStaff(): Promise<{
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

  it("lets a manager (analytics.manual_sales.write) insert a manual sales entry scoped to their own tenant", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    const dishId = await seedPublishedDish(admin, fixture.tenantA.tenantId);

    const result = await queryAsUser(
      admin,
      seed.managerId,
      `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date, channel, entered_by_user_id)
       values ($1, $2, 4, '2026-09-01', 'Lieferando', $3) returning id`,
      [fixture.tenantA.tenantId, dishId, seed.managerId],
    );
    expect(result.rows).toHaveLength(1);
  });

  it("denies a staff member without analytics.manual_sales.write from inserting a manual sale (permission-denied case)", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    const dishId = await seedPublishedDish(admin, fixture.tenantB.tenantId);

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: seed.staffId,
      sql: `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date, entered_by_user_id)
            values ($1, $2, 1, '2026-09-01', $3)`,
      params: [fixture.tenantB.tenantId, dishId, seed.staffId],
    });
  });

  it("never leaks another tenant's manual sales entries (cross-tenant isolation, insert and select)", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    await seedPublishedDish(admin, fixture.tenantA.tenantId);
    const dishIdB = await seedPublishedDish(admin, fixture.tenantB.tenantId, {
      name: "Geheimgericht",
    });

    await admin.query(
      `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date) values ($1, $2, 9, '2026-09-01')`,
      [fixture.tenantB.tenantId, dishIdB],
    );

    // tenantA's manager must not be able to insert into tenantB, nor read tenantB's rows.
    await expectCrossTenantDenied({
      client: admin,
      actorUserId: seed.managerId,
      sql: `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date) values ($1, $2, 1, '2026-09-01')`,
      params: [fixture.tenantB.tenantId, dishIdB],
    });

    const readResult = await queryAsUser(
      admin,
      seed.managerId,
      `select id from manual_sales_entries where tenant_id = $1`,
      [fixture.tenantB.tenantId],
    );
    expect(readResult.rows).toHaveLength(0);

    // Sanity check: tenantB's own owner can see it.
    const ownRead = await queryAsUser(
      admin,
      fixture.tenantB.ownerId,
      `select dish_id from manual_sales_entries where tenant_id = $1`,
      [fixture.tenantB.tenantId],
    );
    expect(ownRead.rows).toEqual([{ dish_id: dishIdB }]);
  });

  it("never writes to or reads from orders/order_items/payments -- structurally separate from real order data", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    const dishId = await seedPublishedDish(admin, fixture.tenantA.tenantId);

    await queryAsUser(
      admin,
      seed.managerId,
      `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date, channel, entered_by_user_id)
       values ($1, $2, 10, '2026-09-01', 'Vor Ort', $3)`,
      [fixture.tenantA.tenantId, dishId, seed.managerId],
    );

    const orders = await admin.query(`select count(*)::int as count from orders where tenant_id = $1`, [
      fixture.tenantA.tenantId,
    ]);
    const orderItems = await admin.query(
      `select count(*)::int as count from order_items where tenant_id = $1`,
      [fixture.tenantA.tenantId],
    );
    const payments = await admin.query(
      `select count(*)::int as count from payments where tenant_id = $1`,
      [fixture.tenantA.tenantId],
    );

    expect(orders.rows[0]!.count).toBe(0);
    expect(orderItems.rows[0]!.count).toBe(0);
    expect(payments.rows[0]!.count).toBe(0);
  });

  it("get_analytics_dashboard_summary() reports manual sales additively, never folded into real-order revenue figures", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    const dishId = await seedPublishedDish(admin, fixture.tenantA.tenantId, { priceCents: 1200 });
    const asOf = new Date("2026-09-01T12:00:00Z");

    await admin.query(
      `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date, channel)
       values ($1, $2, 3, '2026-09-01', 'Lieferando')`,
      [fixture.tenantA.tenantId, dishId],
    );

    const result = await queryAsUser(
      admin,
      seed.managerId,
      `select get_analytics_dashboard_summary($1, $2) as summary`,
      [fixture.tenantA.tenantId, asOf.toISOString()],
    );
    const summary = result.rows[0]!.summary as Record<string, unknown>;

    expect(summary.manualSalesTodayUnits).toBe(3);
    expect(summary.manualSalesTodayEstimatedRevenueCents).toBe(3600);
    // Real-order figures stay untouched -- no payments were ever seeded.
    expect(summary.grossRevenueTodayCents).toBe(0);
    expect(summary.netRevenueTodayCents).toBe(0);
    expect(summary.paidOrdersTodayCount).toBe(0);
  });

  it("get_analytics_dashboard_summary() only counts a manual entry on its own sale_date, not other days", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    const dishId = await seedPublishedDish(admin, fixture.tenantA.tenantId, { priceCents: 500 });

    await admin.query(
      `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date) values ($1, $2, 7, '2026-08-15')`,
      [fixture.tenantA.tenantId, dishId],
    );

    const result = await queryAsUser(
      admin,
      seed.managerId,
      `select get_analytics_dashboard_summary($1, $2) as summary`,
      [fixture.tenantA.tenantId, new Date("2026-09-01T12:00:00Z").toISOString()],
    );
    const summary = result.rows[0]!.summary as Record<string, unknown>;
    expect(summary.manualSalesTodayUnits).toBe(0);
  });

  it("get_dish_performance_stats() reports manual units/estimated revenue per dish, additively and separately", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    const dishId = await seedPublishedDish(admin, fixture.tenantA.tenantId, { priceCents: 800 });

    await admin.query(
      `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date) values ($1, $2, 2, current_date)`,
      [fixture.tenantA.tenantId, dishId],
    );

    const result = await queryAsUser(
      admin,
      seed.managerId,
      `select get_dish_performance_stats($1) as stats`,
      [fixture.tenantA.tenantId],
    );
    const stats = result.rows[0]!.stats as Array<Record<string, unknown>>;
    const dish = stats.find((s) => s.dishId === dishId)!;

    expect(dish.manualUnitsSold).toBe(2);
    expect(dish.manualEstimatedRevenueCents).toBe(1600);
    // Real-order figures stay untouched -- no order_items were ever seeded.
    expect(dish.unitsSold).toBe(0);
    expect(dish.revenueCents).toBe(0);
  });

  it("denies a member without analytics.read from reading dish performance stats with manual sales present (permission-denied case)", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    const dishId = await seedPublishedDish(admin, fixture.tenantB.tenantId);
    await admin.query(
      `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date) values ($1, $2, 5, current_date)`,
      [fixture.tenantB.tenantId, dishId],
    );

    await expect(
      queryAsUser(admin, seed.staffId, `select get_dish_performance_stats($1) as stats`, [
        fixture.tenantB.tenantId,
      ]),
    ).rejects.toThrow(/insufficient_privilege|permission/i);
  });
});
