// Integration tests for the `email_sends` operational log table (ticket #40).
// Regression coverage for the Opus epic-7 batch review finding (MEDIUM,
// test-coverage gap): the migration that created this table
// (20260810100000_order_confirmation_email_sends.sql) shipped an RLS policy
// but had no cross-tenant test proving it actually denies, and no test
// proving `authenticated`/`anon` have no write grant on it at all -- only
// `service_role` (the webhook path, apps/web/src/lib/notifications/
// order-confirmation-email.ts) ever writes this table. Same DB-probe/skip
// pattern as the other database integration suites in this package.
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
    throw new Error(`[email-sends.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(`[email-sends.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`);
}

describe.skipIf(!dbAvailable)(
  "email_sends (ticket #40, Opus epic-7 batch review finding 1)",
  () => {
    const admin = new Client({ connectionString: DB_URL });
    let fixture: TwoTenantFixture;

    beforeAll(async () => {
      await admin.connect();
    });

    afterEach(async () => {
      if (fixture) {
        await admin.query(`delete from email_sends where tenant_id in ($1, $2)`, [
          fixture.tenantA.tenantId,
          fixture.tenantB.tenantId,
        ]);
      }
      await fixture?.cleanup();
    });

    afterAll(async () => {
      await admin.end();
    });

    it("lets a tenant member read their own tenant's email_sends row (written server-side, service_role)", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      // Rows are only ever written by trusted server code via the service-role
      // client (the webhook path) -- simulated here with the raw superuser
      // admin connection, standing in for service_role, never `queryAsUser`.
      await admin.query(
        `insert into email_sends (tenant_id, email_type, status) values ($1, 'order_confirmation', 'sent')`,
        [tenantA.tenantId],
      );

      const read = await queryAsUser<{ status: string }>(
        admin,
        tenantA.ownerId,
        `select status from email_sends where tenant_id = $1`,
        [tenantA.tenantId],
      );
      expect(read.rows).toEqual([{ status: "sent" }]);
    });

    it("never lets tenant B read tenant A's email_sends rows (cross-tenant isolation)", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA, tenantB } = fixture;

      await admin.query(
        `insert into email_sends (tenant_id, email_type, status, failure_reason)
       values ($1, 'order_confirmation', 'failed', 'resend_rate_limited')`,
        [tenantA.tenantId],
      );

      await expectCrossTenantDenied({
        client: admin,
        actorUserId: tenantB.ownerId,
        sql: `select status from email_sends where tenant_id = $1`,
        params: [tenantA.tenantId],
      });
    });

    it("never lets an authenticated tenant member (even the Owner, in their own tenant) insert an email_sends row directly", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      await expect(
        queryAsUser(
          admin,
          tenantA.ownerId,
          `insert into email_sends (tenant_id, email_type, status) values ($1, 'order_confirmation', 'sent') returning id`,
          [tenantA.tenantId],
        ),
      ).rejects.toThrow(/permission denied|row-level security/i);

      const rows = await admin.query(`select 1 from email_sends where tenant_id = $1`, [
        tenantA.tenantId,
      ]);
      expect(rows.rows).toHaveLength(0);
    });

    it("never lets an authenticated tenant member update or delete an email_sends row", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      await admin.query(
        `insert into email_sends (tenant_id, email_type, status) values ($1, 'order_confirmation', 'sent')`,
        [tenantA.tenantId],
      );

      await expect(
        queryAsUser(
          admin,
          tenantA.ownerId,
          `update email_sends set status = 'failed' where tenant_id = $1`,
          [tenantA.tenantId],
        ),
      ).rejects.toThrow(/permission denied|row-level security/i);

      await expect(
        queryAsUser(admin, tenantA.ownerId, `delete from email_sends where tenant_id = $1`, [
          tenantA.tenantId,
        ]),
      ).rejects.toThrow(/permission denied|row-level security/i);

      const unchanged = await admin.query<{ status: string }>(
        `select status from email_sends where tenant_id = $1`,
        [tenantA.tenantId],
      );
      expect(unchanged.rows[0]).toMatchObject({ status: "sent" });
    });

    it("never lets the anon role read, insert, update, or delete email_sends rows at all", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      await admin.query(
        `insert into email_sends (tenant_id, email_type, status) values ($1, 'order_confirmation', 'sent')`,
        [tenantA.tenantId],
      );

      await admin.query("set role anon");
      try {
        await expect(
          admin.query(`select status from email_sends where tenant_id = $1`, [tenantA.tenantId]),
        ).rejects.toThrow(/permission denied/i);

        await expect(
          admin.query(
            `insert into email_sends (tenant_id, email_type, status) values ($1, 'order_confirmation', 'sent')`,
            [tenantA.tenantId],
          ),
        ).rejects.toThrow(/permission denied/i);

        await expect(
          admin.query(`update email_sends set status = 'failed' where tenant_id = $1`, [
            tenantA.tenantId,
          ]),
        ).rejects.toThrow(/permission denied/i);

        await expect(
          admin.query(`delete from email_sends where tenant_id = $1`, [tenantA.tenantId]),
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await admin.query("reset role");
      }
    });
  },
);
