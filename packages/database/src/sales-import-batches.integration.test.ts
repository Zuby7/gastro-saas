// Integration tests for `sales_import_batches` (ticket #59, Epic 9 follow-up
// "Excel-Import für historische Verkaufsdaten"). Same DB-probe/skip pattern
// as the other database integration suites.
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
    throw new Error(`[sales-import-batches.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(
    `[sales-import-batches.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

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

describe.skipIf(!dbAvailable)("sales_import_batches (ticket #59)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    if (fixture) {
      await admin.query(`delete from sales_import_batches where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
      await admin.query(`delete from manual_sales_entries where tenant_id in ($1, $2)`, [
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

  const headers = ["Artikel", "Menge", "Datum"];
  const rows = [{ rowNumber: 1, cells: { Artikel: "Margherita", Menge: "5", Datum: "2026-08-01" } }];

  it("lets a manager (analytics.manualsales.write) stage an import batch scoped to their own tenant", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;

    const result = await queryAsUser(
      admin,
      seed.managerId,
      `insert into sales_import_batches (tenant_id, created_by_user_id, original_filename, headers, rows, row_count)
       values ($1, $2, 'sales.xlsx', $3, $4, 1) returning id`,
      [fixture.tenantA.tenantId, seed.managerId, JSON.stringify(headers), JSON.stringify(rows)],
    );
    expect(result.rows).toHaveLength(1);
  });

  it("denies a staff member without analytics.manualsales.write from staging an import batch (permission-denied case)", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: seed.staffId,
      sql: `insert into sales_import_batches (tenant_id, created_by_user_id, original_filename, headers, rows, row_count)
            values ($1, $2, 'sales.xlsx', $3, $4, 1)`,
      params: [fixture.tenantB.tenantId, seed.staffId, JSON.stringify(headers), JSON.stringify(rows)],
    });
  });

  it("never leaks another tenant's import batches (cross-tenant isolation, insert and select)", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;

    await admin.query(
      `insert into sales_import_batches (tenant_id, original_filename, headers, rows, row_count)
       values ($1, 'geheim.xlsx', $2, $3, 1)`,
      [fixture.tenantB.tenantId, JSON.stringify(headers), JSON.stringify(rows)],
    );

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: seed.managerId,
      sql: `update sales_import_batches set status = 'discarded' where tenant_id = $1`,
      params: [fixture.tenantB.tenantId],
    });

    const readResult = await queryAsUser(
      admin,
      seed.managerId,
      `select id from sales_import_batches where tenant_id = $1`,
      [fixture.tenantB.tenantId],
    );
    expect(readResult.rows).toHaveLength(0);
  });

  it("rejects a batch with more than 2000 rows (check constraint)", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    const tooManyRows = Array.from({ length: 2001 }, (_, i) => ({
      rowNumber: i + 1,
      cells: { Artikel: "X", Menge: "1", Datum: "2026-08-01" },
    }));

    await expect(
      admin.query(
        `insert into sales_import_batches (tenant_id, original_filename, headers, rows, row_count)
         values ($1, 'zu-viele.xlsx', $2, $3, 2001)`,
        [fixture.tenantA.tenantId, JSON.stringify(headers), JSON.stringify(tooManyRows)],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("bulk-inserting the mapped rows into manual_sales_entries never touches orders/order_items/payments", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    const dishId = await seedPublishedDish(admin, fixture.tenantA.tenantId);

    await queryAsUser(
      admin,
      seed.managerId,
      `insert into manual_sales_entries (tenant_id, dish_id, quantity, sale_date, entered_by_user_id)
       values ($1, $2, 5, '2026-08-01', $3)`,
      [fixture.tenantA.tenantId, dishId, seed.managerId],
    );

    const orders = await admin.query(`select count(*)::int as count from orders where tenant_id = $1`, [
      fixture.tenantA.tenantId,
    ]);
    const payments = await admin.query(
      `select count(*)::int as count from payments where tenant_id = $1`,
      [fixture.tenantA.tenantId],
    );

    expect(orders.rows[0]!.count).toBe(0);
    expect(payments.rows[0]!.count).toBe(0);
  });
});
