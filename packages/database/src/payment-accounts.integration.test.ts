// Integration tests for the Stripe Connect `payment_accounts` table (ticket
// #23). Same DB-probe/skip pattern as the other database integration suites.
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
    throw new Error(`[payment-accounts.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(`[payment-accounts.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`);
}

describe.skipIf(!dbAvailable)("payment_accounts (Stripe Connect onboarding)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    await fixture?.cleanup();
  });

  afterAll(async () => {
    await admin.end();
  });

  async function assignOnlySystemRole(userId: string, tenantId: string, roleKey: string) {
    const membership = await admin.query<{ id: string }>(
      `select id from tenant_memberships where tenant_id = $1 and user_id = $2`,
      [tenantId, userId],
    );
    const membershipId = membership.rows[0]?.id;

    const role = await admin.query<{ id: string }>(
      `select id from roles where tenant_id = $1 and key = $2`,
      [tenantId, roleKey],
    );
    const roleId = role.rows[0]?.id;

    await admin.query(
      `delete from membership_roles
       where membership_id = $1
         and role_id in (select id from roles where tenant_id = $2 and is_system = true)`,
      [membershipId, tenantId],
    );
    await admin.query(`insert into membership_roles (membership_id, role_id) values ($1, $2)`, [
      membershipId,
      roleId,
    ]);
  }

  it("lets an Owner create and read their own tenant's payment_accounts row", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;

    const inserted = await queryAsUser<{ tenant_id: string; status: string }>(
      admin,
      tenantA.ownerId,
      `insert into payment_accounts (tenant_id, stripe_account_id, created_by_user_id)
       values ($1, $2, $3)
       returning tenant_id, status`,
      [tenantA.tenantId, "acct_test_a", tenantA.ownerId],
    );
    expect(inserted.rows[0]).toMatchObject({ tenant_id: tenantA.tenantId, status: "pending" });

    const read = await queryAsUser<{ stripe_account_id: string }>(
      admin,
      tenantA.ownerId,
      `select stripe_account_id from payment_accounts where tenant_id = $1`,
      [tenantA.tenantId],
    );
    expect(read.rows).toEqual([{ stripe_account_id: "acct_test_a" }]);
  });

  // Same-model self-check finding for this risk:payment ticket: a
  // `payments.read` holder must never be able to self-declare their own
  // account "enabled" by writing straight to payment_accounts -- only
  // trusted server code (the return_url page / account.updated webhook,
  // both service_role) may write status/charges_enabled/payouts_enabled
  // after actually verifying with Stripe. Regression test for the RLS/grant
  // fix: `authenticated` has no UPDATE grant on this table at all.
  it("never lets an authenticated tenant member update their own payment_accounts row directly", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;

    await admin.query(
      `insert into payment_accounts (tenant_id, stripe_account_id, created_by_user_id)
       values ($1, $2, $3)`,
      [tenantA.tenantId, "acct_test_self_escalate", tenantA.ownerId],
    );

    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `update payment_accounts set status = 'enabled', charges_enabled = true, payouts_enabled = true where tenant_id = $1`,
        [tenantA.tenantId],
      ),
    ).rejects.toThrow(/permission denied|row-level security/i);

    const unchanged = await admin.query<{ status: string; charges_enabled: boolean }>(
      `select status, charges_enabled from payment_accounts where tenant_id = $1`,
      [tenantA.tenantId],
    );
    expect(unchanged.rows[0]).toMatchObject({ status: "pending", charges_enabled: false });
  });

  it("denies cross-tenant reads and writes of another tenant's payment_accounts row", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;

    await admin.query(
      `insert into payment_accounts (tenant_id, stripe_account_id, created_by_user_id)
       values ($1, $2, $3)`,
      [tenantA.tenantId, "acct_test_cross", tenantA.ownerId],
    );

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantB.ownerId,
      sql: `select stripe_account_id from payment_accounts where tenant_id = $1`,
      params: [tenantA.tenantId],
    });

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantB.ownerId,
      sql: `update payment_accounts set status = 'enabled' where tenant_id = $1 returning tenant_id`,
      params: [tenantA.tenantId],
    });

    await expectCrossTenantDenied({
      client: admin,
      actorUserId: tenantB.ownerId,
      sql: `insert into payment_accounts (tenant_id, stripe_account_id) values ($1, $2) returning tenant_id`,
      params: [tenantA.tenantId, "acct_test_hijack"],
    });
  });

  it("denies a Kitchen-role member (no payments.read) from reading or creating the tenant's payment account", async () => {
    const kitchenUserId = randomUUID();
    fixture = await seedTwoTenantFixture(admin, {
      tenantA: {
        additionalMembers: [
          { userId: kitchenUserId, email: "kitchen-payments@example.test", role: "staff" },
        ],
      },
    });
    const { tenantA } = fixture;
    await assignOnlySystemRole(kitchenUserId, tenantA.tenantId, "kitchen");

    const canReadPayments = await queryAsUser<{ has_tenant_permission: boolean }>(
      admin,
      kitchenUserId,
      `select has_tenant_permission($1, 'payments.read')`,
      [tenantA.tenantId],
    );
    expect(canReadPayments.rows[0]?.has_tenant_permission).toBe(false);

    await admin.query(
      `insert into payment_accounts (tenant_id, stripe_account_id, created_by_user_id)
       values ($1, $2, $3)`,
      [tenantA.tenantId, "acct_test_kitchen", tenantA.ownerId],
    );

    const kitchenRead = await queryAsUser(
      admin,
      kitchenUserId,
      `select stripe_account_id from payment_accounts where tenant_id = $1`,
      [tenantA.tenantId],
    );
    expect(kitchenRead.rows).toHaveLength(0);

    await expect(
      queryAsUser(
        admin,
        kitchenUserId,
        `insert into payment_accounts (tenant_id, stripe_account_id) values ($1, $2)`,
        [tenantA.tenantId, "acct_test_kitchen_2"],
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });

  it("grants Owner and Manager payments.read by default", async () => {
    const managerUserId = randomUUID();
    fixture = await seedTwoTenantFixture(admin, {
      tenantA: {
        additionalMembers: [
          { userId: managerUserId, email: "manager-payments@example.test", role: "manager" },
        ],
      },
    });
    const { tenantA } = fixture;

    const ownerCan = await queryAsUser<{ has_tenant_permission: boolean }>(
      admin,
      tenantA.ownerId,
      `select has_tenant_permission($1, 'payments.read')`,
      [tenantA.tenantId],
    );
    expect(ownerCan.rows[0]?.has_tenant_permission).toBe(true);

    const managerCan = await queryAsUser<{ has_tenant_permission: boolean }>(
      admin,
      managerUserId,
      `select has_tenant_permission($1, 'payments.read')`,
      [tenantA.tenantId],
    );
    expect(managerCan.rows[0]?.has_tenant_permission).toBe(true);
  });
});
