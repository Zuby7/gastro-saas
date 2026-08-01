// Example/acceptance test for the reusable cross-tenant test harness (ticket
// #5). Demonstrates `seedTwoTenantFixture` + `expectCrossTenantDenied`
// against the real tenant/membership/brand/location RLS model from ticket
// #4 (supabase/migrations/20260801040000_*.sql). This is the harness's own
// self-test, not a replacement for packages/database's ad-hoc RLS suite.
//
// Requires a real local Supabase Postgres instance (`supabase start`). Uses
// the same probe/skip pattern as packages/database/src/tenants.integration.test.ts:
// skips locally (clear log message) when no database is reachable and
// CI/SUPABASE_DB_URL aren't set, but throws in CI so this suite can never be
// silently skipped in the one environment guaranteed to run it.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectCrossTenantDenied, queryAsUser, seedTwoTenantFixture } from "./tenant-fixture";
import { getTestDatabaseUrl, isDatabaseRequired, probeTestDatabase } from "./test-database";

const DB_URL = getTestDatabaseUrl();
const dbRequired = isDatabaseRequired();
const dbAvailable = await probeTestDatabase(DB_URL);

if (!dbAvailable) {
  if (dbRequired) {
    throw new Error(
      `[tenant-fixture.integration.test] CI or SUPABASE_DB_URL is set, but no reachable Postgres ` +
        `was found at ${DB_URL}. Refusing to silently skip the cross-tenant harness self-test.`,
    );
  }
  console.warn(
    `[tenant-fixture.integration.test] Skipping: no reachable Postgres at ${DB_URL}. ` +
      "Run `pnpm --filter @gastro-saas/database db:start` to exercise this test locally.",
  );
}

describe.skipIf(!dbAvailable)("seedTwoTenantFixture + expectCrossTenantDenied", () => {
  const admin = new Client({ connectionString: DB_URL });

  beforeAll(async () => {
    await admin.connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  it("seeds two tenants, each with an Owner membership", async () => {
    const fixture = await seedTwoTenantFixture(admin);
    try {
      const tenants = await admin.query(`select id, name from tenants where id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
      expect(tenants.rows).toHaveLength(2);

      const memberships = await admin.query(
        `select tenant_id, user_id, role from tenant_memberships where tenant_id in ($1, $2)`,
        [fixture.tenantA.tenantId, fixture.tenantB.tenantId],
      );
      expect(memberships.rows).toEqual(
        expect.arrayContaining([
          { tenant_id: fixture.tenantA.tenantId, user_id: fixture.tenantA.ownerId, role: "owner" },
          { tenant_id: fixture.tenantB.tenantId, user_id: fixture.tenantB.ownerId, role: "owner" },
        ]),
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("lets a tenant's Owner read their own tenant but not the other tenant", async () => {
    const fixture = await seedTwoTenantFixture(admin);
    try {
      const result = await queryAsUser(
        admin,
        fixture.tenantA.ownerId,
        `select id from tenants order by id`,
      );
      const ids = result.rows.map((row) => row.id as string);
      expect(ids).toContain(fixture.tenantA.tenantId);
      expect(ids).not.toContain(fixture.tenantB.tenantId);
    } finally {
      await fixture.cleanup();
    }
  });

  it("expectCrossTenantDenied: denies reading another tenant's brand", async () => {
    const fixture = await seedTwoTenantFixture(admin);
    const brandBId = randomUUID();
    try {
      await admin.query(`insert into brands (id, tenant_id, name, slug) values ($1, $2, $3, $4)`, [
        brandBId,
        fixture.tenantB.tenantId,
        "Tenant B Brand",
        `tenant-b-brand-${brandBId.slice(0, 8)}`,
      ]);

      await expectCrossTenantDenied({
        client: admin,
        actorUserId: fixture.tenantA.ownerId,
        sql: `select id from brands where tenant_id = $1`,
        params: [fixture.tenantB.tenantId],
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("expectCrossTenantDenied: denies inserting a brand into another tenant", async () => {
    const fixture = await seedTwoTenantFixture(admin);
    try {
      await expectCrossTenantDenied({
        client: admin,
        actorUserId: fixture.tenantA.ownerId,
        sql: `insert into brands (tenant_id, name, slug) values ($1, 'Hostile Insert', 'hostile-insert-harness')`,
        params: [fixture.tenantB.tenantId],
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("expectCrossTenantDenied: denies updating another tenant's location", async () => {
    const fixture = await seedTwoTenantFixture(admin);
    const locationBId = randomUUID();
    try {
      await admin.query(
        `insert into locations (id, tenant_id, name, slug) values ($1, $2, $3, $4)`,
        [
          locationBId,
          fixture.tenantB.tenantId,
          "Tenant B Location",
          `tenant-b-location-${locationBId.slice(0, 8)}`,
        ],
      );

      await expectCrossTenantDenied({
        client: admin,
        actorUserId: fixture.tenantA.ownerId,
        sql: `update locations set name = 'Hacked' where id = $1`,
        params: [locationBId],
      });

      const stillIntact = await admin.query(`select name from locations where id = $1`, [
        locationBId,
      ]);
      expect(stillIntact.rows[0]?.name).toBe("Tenant B Location");
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails the assertion if a cross-tenant read is not actually denied (harness self-check)", async () => {
    const fixture = await seedTwoTenantFixture(admin);
    try {
      // tenantB's own Owner reading tenantB's own tenant row IS allowed by
      // RLS -- expectCrossTenantDenied must correctly report this as a
      // failed assertion, not as "denied", or the harness would be a false
      // sense of security.
      await expect(
        expectCrossTenantDenied({
          client: admin,
          actorUserId: fixture.tenantB.ownerId,
          sql: `select id from tenants where id = $1`,
          params: [fixture.tenantB.tenantId],
        }),
      ).rejects.toThrow();
    } finally {
      await fixture.cleanup();
    }
  });
});
