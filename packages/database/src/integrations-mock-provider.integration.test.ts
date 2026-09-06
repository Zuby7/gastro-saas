// Integration tests for the provider-neutral integration foundation + mock
// provider (Epic 12, ticket #38): the `integrations.manage` permission,
// `create_integration_account()`/`list_integration_accounts()`,
// `record_integration_sync_job()` (menu export + simulated order
// import/confirmation success paths, and the failure path writing to
// `integration_errors`), `list_integration_sync_jobs()`, its audit trail, and
// cross-tenant isolation. Same DB-probe/skip pattern as the other database
// integration suites.
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
      `[integrations-mock-provider.integration.test] CI or SUPABASE_DB_URL is set, but no ` +
        `reachable Postgres was found at ${DB_URL}. Refusing to silently skip the integrations ` +
        "tenant-isolation/permission-boundary suite in CI.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[integrations-mock-provider.integration.test] Skipping: no reachable Postgres at ${DB_URL}. ` +
      "Run `pnpm --filter @gastro-saas/database db:start` to exercise this test locally.",
  );
}

/** Reassigns `userId`'s standard-role membership in `tenantId` to `roleKey`. */
async function reassignToRole(
  admin: Client,
  tenantId: string,
  userId: string,
  roleKey: string,
): Promise<void> {
  await admin.query(
    `delete from membership_roles
      using tenant_memberships tm
      where membership_roles.membership_id = tm.id
        and tm.tenant_id = $1
        and tm.user_id = $2`,
    [tenantId, userId],
  );
  await admin.query(
    `insert into membership_roles (membership_id, role_id)
     select tm.id, r.id
       from tenant_memberships tm
       join roles r on r.tenant_id = tm.tenant_id and r.key = $3
      where tm.tenant_id = $1
        and tm.user_id = $2`,
    [tenantId, userId, roleKey],
  );
}

interface IntegrationAccountRow {
  id: string;
  tenant_id: string;
  provider_key: string;
  label: string;
  status: string;
}

async function createAccount(
  admin: Client,
  actorUserId: string,
  tenantId: string,
  label = "Mock-Integration",
): Promise<IntegrationAccountRow> {
  // `create_integration_account` returns the `integration_accounts` composite
  // row type. Selecting it as a single scalar column (`select f() as alias`)
  // makes `pg` hand back the row's raw, un-decoded composite text
  // representation instead of an object with named fields. Using the
  // `(f()).*` target-list expansion instead avoids that, but re-evaluates
  // a volatile function once *per expanded column* (a well-known Postgres
  // gotcha) -- harmless here only because the write is an idempotent
  // upsert, but the same shape bit `record_integration_sync_job` below
  // (a plain INSERT, not idempotent -- see its own comment). Call the
  // function in the FROM clause instead: exactly one evaluation, and
  // `select *` still decodes every column individually, the same pattern
  // `list_integration_accounts`/`list_integration_sync_jobs` already use.
  const result = await queryAsUser<IntegrationAccountRow>(
    admin,
    actorUserId,
    `select * from create_integration_account($1, 'mock', $2)`,
    [tenantId, label],
  );
  return result.rows[0]!;
}

describe.skipIf(!dbAvailable)(
  "provider-neutral integration foundation + mock provider (ticket #38, risk:tenant-isolation)",
  () => {
    const admin = new Client({ connectionString: DB_URL });
    let fixture: TwoTenantFixture;

    beforeAll(async () => {
      await admin.connect();
    });

    afterAll(async () => {
      await admin.end();
    });

    afterEach(async () => {
      if (fixture) {
        await admin.query(`delete from audit_logs where tenant_id in ($1, $2)`, [
          fixture.tenantA.tenantId,
          fixture.tenantB.tenantId,
        ]);
        await admin.query(`delete from integration_accounts where tenant_id in ($1, $2)`, [
          fixture.tenantA.tenantId,
          fixture.tenantB.tenantId,
        ]);
      }
      await fixture?.cleanup();
    });

    async function seedFixtureWithStaff(): Promise<{
      fixture: TwoTenantFixture;
      staffAId: string;
      staffBId: string;
    }> {
      const staffAId = randomUUID();
      const staffBId = randomUUID();
      const seeded = await seedTwoTenantFixture(admin, {
        tenantA: { additionalMembers: [{ userId: staffAId, role: "staff" }] },
        tenantB: { additionalMembers: [{ userId: staffBId, role: "staff" }] },
      });
      return { fixture: seeded, staffAId, staffBId };
    }

    it("Owner/Manager system roles hold integrations.manage by default; Kitchen/Service/Marketing do not", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;

      const grants = await admin.query<{ key: string }>(
        `select r.key
           from roles r
           join role_permissions rp on rp.role_id = r.id
          where r.tenant_id = $1
            and rp.permission_key = 'integrations.manage'
          order by r.key`,
        [fixture.tenantA.tenantId],
      );

      expect(grants.rows.map((r) => r.key)).toEqual(["manager", "owner"]);
    });

    it("acceptance criterion 1 (menu export): create_integration_account + record_integration_sync_job(menu_export) succeed and are listable", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");

      const account = await createAccount(admin, seed.staffAId, fixture.tenantA.tenantId);
      expect(account.status).toBe("mock");

      // Same composite-decoding concern as `createAccount()` above -- but
      // `record_integration_sync_job` is a plain INSERT (not an idempotent
      // upsert), so it must be called in the FROM clause (`select * from
      // f(...)`), not as `(f()).*` in the SELECT list: the latter is a
      // documented Postgres gotcha where a function referenced via `.*`
      // target-list expansion gets re-evaluated once per expanded output
      // column -- 9 columns on `integration_sync_jobs` silently insert the
      // same "succeeded" job 9 times instead of once.
      const jobResult = await queryAsUser<{ id: string; status: string; job_type: string }>(
        admin,
        seed.staffAId,
        `select * from record_integration_sync_job($1, $2, 'menu_export', 'succeeded', $3::jsonb, null)`,
        [fixture.tenantA.tenantId, account.id, JSON.stringify({ categoryCount: 2, dishCount: 5 })],
      );
      expect(jobResult.rows[0]!.status).toBe("succeeded");
      expect(jobResult.rows[0]!.job_type).toBe("menu_export");

      const listResult = await queryAsUser<{ id: string; job_type: string }>(
        admin,
        seed.staffAId,
        `select id, job_type from list_integration_sync_jobs($1, null)`,
        [fixture.tenantA.tenantId],
      );
      expect(listResult.rows).toHaveLength(1);
      expect(listResult.rows[0]!.job_type).toBe("menu_export");
    });

    it("acceptance criterion 1 (simulated incoming order): order_import then order_confirmation both succeed", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
      const account = await createAccount(admin, seed.staffAId, fixture.tenantA.tenantId);

      await queryAsUser(
        admin,
        seed.staffAId,
        `select record_integration_sync_job($1, $2, 'order_import', 'succeeded', $3::jsonb, null)`,
        [fixture.tenantA.tenantId, account.id, JSON.stringify({ externalOrderId: "mock-order-1" })],
      );
      await queryAsUser(
        admin,
        seed.staffAId,
        `select record_integration_sync_job($1, $2, 'order_confirmation', 'succeeded', $3::jsonb, null)`,
        [fixture.tenantA.tenantId, account.id, JSON.stringify({ externalOrderId: "mock-order-1" })],
      );

      const listResult = await queryAsUser<{ job_type: string; status: string }>(
        admin,
        seed.staffAId,
        `select job_type, status from list_integration_sync_jobs($1, $2) order by created_at`,
        [fixture.tenantA.tenantId, account.id],
      );
      expect(listResult.rows.map((r) => r.job_type)).toEqual([
        "order_import",
        "order_confirmation",
      ]);
      expect(listResult.rows.every((r) => r.status === "succeeded")).toBe(true);
    });

    describe("failure path: integration_errors + account status", () => {
      it("a failed sync job writes an integration_errors row and flips the account to status=error; a later success clears it back to mock", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
        const account = await createAccount(admin, seed.staffAId, fixture.tenantA.tenantId);

        await queryAsUser(
          admin,
          seed.staffAId,
          `select record_integration_sync_job($1, $2, 'menu_export', 'failed', '{}'::jsonb, 'Simulated failure')`,
          [fixture.tenantA.tenantId, account.id],
        );

        const afterFailure = await admin.query<{ status: string }>(
          `select status from integration_accounts where id = $1`,
          [account.id],
        );
        expect(afterFailure.rows[0]!.status).toBe("error");

        const errors = await admin.query<{ message: string }>(
          `select message from integration_errors where tenant_id = $1`,
          [fixture.tenantA.tenantId],
        );
        expect(errors.rows).toHaveLength(1);
        expect(errors.rows[0]!.message).toBe("Simulated failure");

        await queryAsUser(
          admin,
          seed.staffAId,
          `select record_integration_sync_job($1, $2, 'menu_export', 'succeeded', '{}'::jsonb, null)`,
          [fixture.tenantA.tenantId, account.id],
        );

        const afterSuccess = await admin.query<{ status: string }>(
          `select status from integration_accounts where id = $1`,
          [account.id],
        );
        expect(afterSuccess.rows[0]!.status).toBe("mock");
      });
    });

    describe("permission boundary (acceptance criterion: integrations.manage required)", () => {
      it("denies a member without integrations.manage (Service) from creating an integration account", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "service");

        await expect(
          queryAsUser(
            admin,
            seed.staffAId,
            `select create_integration_account($1, 'mock', 'Mock-Integration')`,
            [fixture.tenantA.tenantId],
          ),
        ).rejects.toThrow(/insufficient_privilege|Missing permission/i);
      });

      it("that same Service member is also denied direct SELECT on integration_accounts (RLS backstop)", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
        const account = await createAccount(admin, seed.staffAId, fixture.tenantA.tenantId);
        await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "service");

        const directSelect = await queryAsUser(
          admin,
          seed.staffAId,
          `select id from integration_accounts where id = $1`,
          [account.id],
        );
        expect(directSelect.rows).toHaveLength(0);
      });
    });

    describe("cross-tenant isolation", () => {
      it("never lets a Manager of tenant A see or record sync jobs against tenant B's integration account", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
        await reassignToRole(admin, fixture.tenantB.tenantId, seed.staffBId, "manager");
        const accountB = await createAccount(admin, seed.staffBId, fixture.tenantB.tenantId);

        // Tenant A's own tenant_id, tenant B's integration_account_id:
        // record_integration_sync_job()'s own tenant-match check finds no
        // matching row.
        await expect(
          queryAsUser(
            admin,
            seed.staffAId,
            `select record_integration_sync_job($1, $2, 'menu_export', 'succeeded', '{}'::jsonb, null)`,
            [fixture.tenantA.tenantId, accountB.id],
          ),
        ).rejects.toThrow(/Integration account not found/i);

        const jobs = await admin.query(
          `select id from integration_sync_jobs where tenant_id = $1`,
          [fixture.tenantA.tenantId],
        );
        expect(jobs.rows).toHaveLength(0);
      });

      it("never leaks tenant B's integration accounts to tenant A's Manager via a plain SELECT or list_integration_accounts", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
        await reassignToRole(admin, fixture.tenantB.tenantId, seed.staffBId, "manager");
        const accountB = await createAccount(admin, seed.staffBId, fixture.tenantB.tenantId);

        await expectCrossTenantDenied({
          client: admin,
          actorUserId: seed.staffAId,
          sql: `select id from integration_accounts where id = $1`,
          params: [accountB.id],
        });

        const list = await queryAsUser<{ id: string }>(
          admin,
          seed.staffAId,
          `select id from list_integration_accounts($1)`,
          [fixture.tenantA.tenantId],
        );
        expect(list.rows.map((r) => r.id)).not.toContain(accountB.id);
      });
    });

    describe("observability: sync jobs are audited", () => {
      it("appends an audit_logs row for every recorded sync job", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
        const account = await createAccount(admin, seed.staffAId, fixture.tenantA.tenantId);

        await queryAsUser(
          admin,
          seed.staffAId,
          `select record_integration_sync_job($1, $2, 'menu_export', 'succeeded', $3::jsonb, null)`,
          [fixture.tenantA.tenantId, account.id, JSON.stringify({ categoryCount: 1 })],
        );

        const logs = await admin.query<{
          action: string;
          actor_user_id: string;
          target_type: string;
          metadata: { jobType: string; status: string; integrationAccountId: string };
        }>(
          `select action, actor_user_id, target_type, metadata
             from audit_logs
            where tenant_id = $1
              and action = 'integrations.sync_job_recorded'`,
          [fixture.tenantA.tenantId],
        );

        expect(logs.rows).toHaveLength(1);
        expect(logs.rows[0]).toMatchObject({
          actor_user_id: seed.staffAId,
          target_type: "integration_sync_job",
        });
        expect(logs.rows[0]!.metadata).toMatchObject({
          jobType: "menu_export",
          status: "succeeded",
          integrationAccountId: account.id,
        });
      });
    });

    it("rejects an invalid job type / status", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
      const account = await createAccount(admin, seed.staffAId, fixture.tenantA.tenantId);

      await expect(
        queryAsUser(
          admin,
          seed.staffAId,
          `select record_integration_sync_job($1, $2, 'not-a-real-type', 'succeeded', '{}'::jsonb, null)`,
          [fixture.tenantA.tenantId, account.id],
        ),
      ).rejects.toThrow(/Invalid integration job type/i);

      await expect(
        queryAsUser(
          admin,
          seed.staffAId,
          `select record_integration_sync_job($1, $2, 'menu_export', 'not-a-real-status', '{}'::jsonb, null)`,
          [fixture.tenantA.tenantId, account.id],
        ),
      ).rejects.toThrow(/Invalid integration job status/i);
    });
  },
);
