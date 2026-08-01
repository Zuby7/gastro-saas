// Integration tests for `audit_logs`/`analytics_events` (ticket #6,
// supabase/migrations/20260801050000_audit_log_and_analytics_events_skeleton.sql),
// added in response to Opus review cycle 1 (artifacts/reviews/issue-6.json),
// which found: (a) the immutability trigger broke real auth.users/tenants
// deletion, (b) TRUNCATE was never revoked, (c) the INSERT grant let a
// tenant member forge another user as actor_user_id, and (d) zero
// cross-tenant test existed for either table despite the #5
// (packages/testing) harness being available.
//
// Same DB-probe/skip pattern as tenants.integration.test.ts: requires a
// real local Supabase Postgres instance; skips locally with a warning if
// unreachable, throws in CI (CI or SUPABASE_DB_URL set) instead of silently
// skipping the tenant-isolation/immutability suite in the one environment
// that can actually run it.
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
      `[audit-logs.integration.test] CI or SUPABASE_DB_URL is set, but no reachable Postgres was ` +
        `found at ${DB_URL}. Refusing to silently skip the audit_logs immutability/tenant-isolation ` +
        "suite in CI -- check the migration-check workflow's `supabase start` step.",
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[audit-logs.integration.test] Skipping: no reachable Postgres at ${DB_URL}. ` +
      "Run `pnpm --filter @gastro-saas/database db:start` (requires a working local Docker setup) " +
      "to exercise this test locally, or rely on the migration-check CI workflow.",
  );
}

describe.skipIf(!dbAvailable)("audit_logs / analytics_events RLS and immutability", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  afterEach(async () => {
    await fixture?.cleanup();
  });

  it("lets a tenant member insert into their own tenant's audit_logs (verified via admin), never the other tenant's via SELECT", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;

    // No `returning` here: `authenticated` has no `select` grant on
    // audit_logs (see below), and Postgres requires `select` privilege to
    // evaluate a `RETURNING` clause, independent of RLS -- adding one would
    // make this insert fail on that unrelated grant, not prove anything
    // about the insert policy itself.
    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into audit_logs (tenant_id, actor_user_id, action, target_type)
       values ($1, $2, 'dish.updated', 'dish')`,
      [tenantA.tenantId, tenantA.ownerId],
    );

    // Verify the row actually landed, via the admin (RLS-bypassing)
    // connection -- `authenticated` has no `select` grant on audit_logs at
    // all yet (ticket #6 scope note: audit.read is defined but not
    // enforced/used anywhere), so a tenant member cannot read even its own
    // rows back through RLS today.
    const ownRows = await admin.query(`select tenant_id from audit_logs where tenant_id = $1`, [
      tenantA.tenantId,
    ]);
    expect(ownRows.rows).toHaveLength(1);

    // Confirm that absence of a select grant denies access uniformly --
    // including any attempt to read the other tenant's rows -- rather than
    // e.g. only RLS filtering kicking in for cross-tenant reads while
    // same-tenant reads work.
    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantA.ownerId,
      sql: `select tenant_id from audit_logs where tenant_id = $1`,
      params: [tenantB.tenantId],
    });
  });

  it("denies inserting an audit_logs row into a tenant the user is not a member of", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantA.ownerId,
      sql: `insert into audit_logs (tenant_id, actor_user_id, action, target_type)
            values ($1, $2, 'hostile.insert', 'dish')`,
      params: [tenantB.tenantId, tenantA.ownerId],
    });
  });

  it("denies forging another user as actor_user_id, even within the actor's own tenant", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;

    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `insert into audit_logs (tenant_id, actor_user_id, action, target_type)
         values ($1, $2, 'framed.action', 'dish')`,
        // tenantA's Owner tries to insert a row impersonating tenant B's
        // Owner (a real, existing user, so the FK is satisfied and only the
        // actor-forgery RLS check is exercised) as the actor.
        [tenantA.tenantId, tenantB.ownerId],
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);

    // A null actor_user_id (system-initiated action) is still permitted (no
    // `returning` -- see the note in the first test in this file).
    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into audit_logs (tenant_id, actor_user_id, action, target_type)
       values ($1, null, 'system.action', 'dish')`,
      [tenantA.tenantId],
    );
    const systemRows = await admin.query(
      `select id from audit_logs where tenant_id = $1 and action = 'system.action'`,
      [tenantA.tenantId],
    );
    expect(systemRows.rows).toHaveLength(1);
  });

  it("rejects UPDATE, DELETE, and TRUNCATE on audit_logs for `authenticated`", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;

    const inserted = await admin.query<{ id: string }>(
      `insert into audit_logs (tenant_id, actor_user_id, action, target_type)
       values ($1, $2, 'dish.updated', 'dish') returning id`,
      [tenantA.tenantId, tenantA.ownerId],
    );
    const rowId = inserted.rows[0]?.id;

    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `update audit_logs set action = 'tampered' where id = $1`,
        [rowId],
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      queryAsUser(admin, tenantA.ownerId, `delete from audit_logs where id = $1`, [rowId]),
    ).rejects.toThrow(/permission denied/i);

    await expect(queryAsUser(admin, tenantA.ownerId, `truncate table audit_logs`)).rejects.toThrow(
      /permission denied|append-only/i,
    );

    // The row survived all three attempts.
    const stillThere = await admin.query(`select action from audit_logs where id = $1`, [rowId]);
    expect(stillThere.rows[0]?.action).toBe("dish.updated");
  });

  it("lets a tenant member insert and read their own tenant's analytics_events, never the other tenant's", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;

    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into analytics_events (tenant_id, event_type) values ($1, 'dish.viewed')`,
      [tenantA.tenantId],
    );

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantA.ownerId,
      sql: `insert into analytics_events (tenant_id, event_type) values ($1, 'hostile.insert')`,
      params: [tenantB.tenantId],
    });

    await queryAsUser(
      admin,
      tenantB.ownerId,
      `insert into analytics_events (tenant_id, event_type) values ($1, 'dish.viewed')`,
      [tenantB.tenantId],
    );

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantA.ownerId,
      sql: `select tenant_id from analytics_events where tenant_id = $1`,
      params: [tenantB.tenantId],
    });
  });

  // The three FK-deletion scenarios from Opus review cycle 1 -- run outside
  // the shared two-tenant fixture (which now purges audit_logs before
  // deleting tenants in its own cleanup()) so each scenario can assert the
  // *un-purged* real-world behavior directly.
  describe("FK-deletion scenarios (Opus review cycle 1 regression)", () => {
    it("(a) deleting an auth.users row with an audit entry succeeds, nulling actor_user_id", async () => {
      const tenantId = randomUUID();
      const userId = randomUUID();
      const otherOwnerId = randomUUID();

      await admin.query(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [
        userId,
        `user-${userId.slice(0, 8)}@example.test`,
        otherOwnerId,
        `owner-${otherOwnerId.slice(0, 8)}@example.test`,
      ]);
      await admin.query("begin");
      await admin.query(`insert into tenants (id, name, slug) values ($1, $2, $3)`, [
        tenantId,
        "FK Scenario A Tenant",
        `fk-scenario-a-${tenantId.slice(0, 8)}`,
      ]);
      await admin.query(
        `insert into tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`,
        [tenantId, otherOwnerId],
      );
      await admin.query("commit");

      const inserted = await admin.query<{ id: string }>(
        `insert into audit_logs (tenant_id, actor_user_id, action, target_type)
         values ($1, $2, 'user.deleted.fixture', 'user') returning id`,
        [tenantId, userId],
      );
      const rowId = inserted.rows[0]?.id;

      await expect(
        admin.query(`delete from auth.users where id = $1`, [userId]),
      ).resolves.not.toThrow();

      const row = await admin.query(`select actor_user_id from audit_logs where id = $1`, [rowId]);
      expect(row.rows[0]?.actor_user_id).toBeNull();

      // Cleanup: purge the audit row before the tenant (on delete restrict).
      await admin.query(`delete from audit_logs where tenant_id = $1`, [tenantId]);
      await admin.query(`delete from tenants where id = $1`, [tenantId]);
      await admin.query(`delete from auth.users where id = $1`, [otherOwnerId]);
    });

    it("(b) deleting a tenant with NO audit entries succeeds", async () => {
      const tenantId = randomUUID();
      const ownerId = randomUUID();

      await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [
        ownerId,
        `owner-${ownerId.slice(0, 8)}@example.test`,
      ]);
      await admin.query("begin");
      await admin.query(`insert into tenants (id, name, slug) values ($1, $2, $3)`, [
        tenantId,
        "FK Scenario B Tenant",
        `fk-scenario-b-${tenantId.slice(0, 8)}`,
      ]);
      await admin.query(
        `insert into tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`,
        [tenantId, ownerId],
      );
      await admin.query("commit");

      await expect(
        admin.query(`delete from tenants where id = $1`, [tenantId]),
      ).resolves.not.toThrow();

      await admin.query(`delete from auth.users where id = $1`, [ownerId]);
    });

    it("(c) deleting a tenant WITH audit entries is rejected (on delete restrict)", async () => {
      const tenantId = randomUUID();
      const ownerId = randomUUID();

      await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [
        ownerId,
        `owner-${ownerId.slice(0, 8)}@example.test`,
      ]);
      await admin.query("begin");
      await admin.query(`insert into tenants (id, name, slug) values ($1, $2, $3)`, [
        tenantId,
        "FK Scenario C Tenant",
        `fk-scenario-c-${tenantId.slice(0, 8)}`,
      ]);
      await admin.query(
        `insert into tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`,
        [tenantId, ownerId],
      );
      await admin.query("commit");

      await admin.query(
        `insert into audit_logs (tenant_id, actor_user_id, action, target_type)
         values ($1, $2, 'tenant.created', 'tenant')`,
        [tenantId, ownerId],
      );

      await expect(admin.query(`delete from tenants where id = $1`, [tenantId])).rejects.toThrow(
        /violates foreign key constraint/i,
      );

      // Cleanup: purge the audit row explicitly (the documented, privileged
      // path), then the tenant deletes normally.
      await admin.query(`delete from audit_logs where tenant_id = $1`, [tenantId]);
      await admin.query(`delete from tenants where id = $1`, [tenantId]);
      await admin.query(`delete from auth.users where id = $1`, [ownerId]);
    });
  });
});
