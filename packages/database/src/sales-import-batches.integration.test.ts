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
    [
      dishId,
      tenantId,
      menuVersionId,
      categoryId,
      options.name ?? "Margherita",
      options.priceCents ?? 1000,
    ],
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
  const rows = [
    { rowNumber: 1, cells: { Artikel: "Margherita", Menge: "5", Datum: "2026-08-01" } },
  ];

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
      params: [
        fixture.tenantB.tenantId,
        seed.staffId,
        JSON.stringify(headers),
        JSON.stringify(rows),
      ],
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

  it("denies a tenant member with neither analytics.read nor analytics.manualsales.write from reading sales_import_batches directly", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    await admin.query(
      `insert into sales_import_batches (tenant_id, original_filename, headers, rows, row_count)
       values ($1, 'geheim.xlsx', $2, $3, 1)`,
      [fixture.tenantB.tenantId, JSON.stringify(headers), JSON.stringify(rows)],
    );

    // seed.staffId is a member of tenantB with neither relevant permission
    // -- plain tenant membership alone must not be enough to read this
    // table (review finding, mirrors manual_sales_entries' own fix).
    const result = await queryAsUser(
      admin,
      seed.staffId,
      `select id from sales_import_batches where tenant_id = $1`,
      [fixture.tenantB.tenantId],
    );
    expect(result.rows).toHaveLength(0);
  });

  it("purge_expired_sales_import_batches() deletes a batch past its expires_at, regardless of status", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;

    const expired = await admin.query<{ id: string }>(
      `insert into sales_import_batches (tenant_id, original_filename, headers, rows, row_count, expires_at)
       values ($1, 'alt.xlsx', $2, $3, 1, now() - interval '1 day') returning id`,
      [fixture.tenantA.tenantId, JSON.stringify(headers), JSON.stringify(rows)],
    );
    const stillValid = await admin.query<{ id: string }>(
      `insert into sales_import_batches (tenant_id, original_filename, headers, rows, row_count, expires_at)
       values ($1, 'neu.xlsx', $2, $3, 1, now() + interval '1 day') returning id`,
      [fixture.tenantA.tenantId, JSON.stringify(headers), JSON.stringify(rows)],
    );

    await admin.query(`select purge_expired_sales_import_batches()`);

    const remaining = await admin.query<{ id: string }>(
      `select id from sales_import_batches where tenant_id = $1`,
      [fixture.tenantA.tenantId],
    );
    expect(remaining.rows.map((r) => r.id)).toEqual([stillValid.rows[0]!.id]);
    expect(remaining.rows.map((r) => r.id)).not.toContain(expired.rows[0]!.id);
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

  it("commit_sales_import_batch() atomically claims the batch and bulk-inserts, denying a second commit attempt", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    const dishId = await seedPublishedDish(admin, fixture.tenantA.tenantId);

    const batch = await queryAsUser(
      admin,
      seed.managerId,
      `insert into sales_import_batches (tenant_id, created_by_user_id, original_filename, headers, rows, row_count)
       values ($1, $2, 'sales.xlsx', $3, $4, 1) returning id`,
      [fixture.tenantA.tenantId, seed.managerId, JSON.stringify(headers), JSON.stringify(rows)],
    );
    const batchId = batch.rows[0]!.id as string;
    const entries = JSON.stringify([{ dishId, quantity: 5, saleDate: "2026-08-01", channel: "" }]);

    const first = await queryAsUser<{ claimed: boolean; imported_count: number }>(
      admin,
      seed.managerId,
      `select claimed, imported_count from commit_sales_import_batch($1, $2, $3, $4)`,
      [fixture.tenantA.tenantId, batchId, entries, seed.managerId],
    );
    expect(first.rows[0]).toEqual({ claimed: true, imported_count: 1 });

    // A second commit attempt against the same (now-committed) batch must
    // not claim again or insert a second time.
    const second = await queryAsUser<{ claimed: boolean; imported_count: number }>(
      admin,
      seed.managerId,
      `select claimed, imported_count from commit_sales_import_batch($1, $2, $3, $4)`,
      [fixture.tenantA.tenantId, batchId, entries, seed.managerId],
    );
    expect(second.rows[0]).toEqual({ claimed: false, imported_count: 0 });

    const salesCount = await admin.query(
      `select count(*)::int as count from manual_sales_entries where tenant_id = $1 and dish_id = $2`,
      [fixture.tenantA.tenantId, dishId],
    );
    expect(salesCount.rows[0]!.count).toBe(1);
  });

  // Review finding (PR #139): two concurrent confirm calls for the same
  // batch must produce exactly row_count entries, not double. Fires both
  // calls on separate connections truly in parallel (Promise.all, not
  // sequential awaits) -- the atomic claim-then-insert inside
  // commit_sales_import_batch() (a single `update ... where status =
  // 'pending' returning id` before the insert) relies on Postgres's own
  // row-level locking to serialize the two UPDATEs: whichever commits
  // first wins the claim, and the second's UPDATE then matches zero rows
  // (status is no longer 'pending'), so its insert never runs.
  it("two truly concurrent confirm calls for the same batch import exactly once, not twice", async () => {
    const seed = await seedFixtureWithManagerAndStaff();
    fixture = seed.fixture;
    const dishId = await seedPublishedDish(admin, fixture.tenantA.tenantId);

    const batch = await queryAsUser(
      admin,
      seed.managerId,
      `insert into sales_import_batches (tenant_id, created_by_user_id, original_filename, headers, rows, row_count)
       values ($1, $2, 'sales.xlsx', $3, $4, 1) returning id`,
      [fixture.tenantA.tenantId, seed.managerId, JSON.stringify(headers), JSON.stringify(rows)],
    );
    const batchId = batch.rows[0]!.id as string;
    const entries = JSON.stringify([{ dishId, quantity: 5, saleDate: "2026-08-01", channel: "" }]);

    const connA = new Client({ connectionString: DB_URL });
    const connB = new Client({ connectionString: DB_URL });
    await connA.connect();
    await connB.connect();

    try {
      const [resultA, resultB] = await Promise.all([
        queryAsUser<{ claimed: boolean; imported_count: number }>(
          connA,
          seed.managerId,
          `select claimed, imported_count from commit_sales_import_batch($1, $2, $3, $4)`,
          [fixture.tenantA.tenantId, batchId, entries, seed.managerId],
        ),
        queryAsUser<{ claimed: boolean; imported_count: number }>(
          connB,
          seed.managerId,
          `select claimed, imported_count from commit_sales_import_batch($1, $2, $3, $4)`,
          [fixture.tenantA.tenantId, batchId, entries, seed.managerId],
        ),
      ]);

      const claims = [resultA.rows[0]!, resultB.rows[0]!];
      const claimedCount = claims.filter((c) => c.claimed).length;
      expect(claimedCount).toBe(1); // exactly one of the two actually claimed it.
      expect(claims.reduce((sum, c) => sum + c.imported_count, 0)).toBe(1); // row_count, not double.

      const salesCount = await admin.query(
        `select count(*)::int as count from manual_sales_entries where tenant_id = $1 and dish_id = $2`,
        [fixture.tenantA.tenantId, dishId],
      );
      expect(salesCount.rows[0]!.count).toBe(1);
    } finally {
      await connA.end();
      await connB.end();
    }
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

    const orders = await admin.query(
      `select count(*)::int as count from orders where tenant_id = $1`,
      [fixture.tenantA.tenantId],
    );
    const payments = await admin.query(
      `select count(*)::int as count from payments where tenant_id = $1`,
      [fixture.tenantA.tenantId],
    );

    expect(orders.rows[0]!.count).toBe(0);
    expect(payments.rows[0]!.count).toBe(0);
  });
});
