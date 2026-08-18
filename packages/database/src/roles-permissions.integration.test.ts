// Integration tests for tenant-scoped RBAC introduced by ticket #9.
//
// Same DB-probe/skip pattern as the other database integration suites: these
// tests exercise real RLS policies/functions against local Supabase Postgres
// when available, and fail instead of silently skipping in CI.
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
      `[roles-permissions.integration.test] CI or SUPABASE_DB_URL is set, but no reachable ` +
        `Postgres was found at ${DB_URL}. Refusing to silently skip the RBAC permission-boundary ` +
        "suite in CI -- check the migration-check workflow's `supabase start` step.",
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[roles-permissions.integration.test] Skipping: no reachable Postgres at ${DB_URL}. ` +
      "Run `pnpm --filter @gastro-saas/database db:start` (requires a working local Docker setup) " +
      "to exercise this test locally, or rely on the migration-check CI workflow.",
  );
}

describe.skipIf(!dbAvailable)("roles / permissions RBAC", () => {
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
         and role_id in (
           select id from roles
            where tenant_id = $2
              and is_system = true
         )`,
      [membershipId, tenantId],
    );
    await admin.query(`insert into membership_roles (membership_id, role_id) values ($1, $2)`, [
      membershipId,
      roleId,
    ]);

    return { membershipId, roleId };
  }

  it("seeds every standard MVP permission key", async () => {
    fixture = await seedTwoTenantFixture(admin);

    const result = await admin.query<{ key: string }>(`select key from permissions order by key`);
    expect(result.rows.map((row) => row.key)).toEqual([
      "analytics.read",
      "audit.read",
      "menu.availability.manage",
      "menu.publish",
      "menu.read",
      "menu.write",
      "orders.cancel",
      "orders.manage",
      "orders.read",
      "payments.connect",
      "payments.read",
      "payments.refund",
      "roles.manage",
      "tenant.settings.write",
      "users.invite",
      "users.manage",
    ]);
  });

  // Regression test for the Epic 8 Opus batch review, CRITICAL finding 1:
  // 20260817110000_dish_option_availability_and_scheduling.sql's
  // `create or replace function seed_standard_roles_for_tenant()` was
  // reconstructed from an older version of the function and silently
  // dropped orders.read/orders.manage (added by sibling tickets #27/#28) and
  // menu.read (an older residual gap) from every newly created tenant's
  // default grants.
  // 20260817120000_fix_seed_standard_roles_permission_regression.sql fixes
  // this -- pin the exact expected grant set per system role here so any
  // future accidental drop is caught immediately by this test, not by an
  // Opus review cycle later.
  it("grants the exact expected default permission set per system role for a freshly seeded tenant", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;

    const result = await admin.query<{ role_key: string; permission_key: string }>(
      `select r.key as role_key, rp.permission_key
         from roles r
         join role_permissions rp on rp.role_id = r.id
        where r.tenant_id = $1
        order by r.key, rp.permission_key`,
      [tenantA.tenantId],
    );

    const grantsByRole = new Map<string, string[]>();
    for (const row of result.rows) {
      const bucket = grantsByRole.get(row.role_key) ?? [];
      bucket.push(row.permission_key);
      grantsByRole.set(row.role_key, bucket);
    }

    const allPermissions = await admin.query<{ key: string }>(
      `select key from permissions order by key`,
    );

    expect(grantsByRole.get("owner")).toEqual(allPermissions.rows.map((row) => row.key));

    expect(grantsByRole.get("manager")).toEqual(
      [
        "analytics.read",
        "audit.read",
        "menu.availability.manage",
        "menu.publish",
        "menu.read",
        "orders.cancel",
        "orders.manage",
        "orders.read",
        "payments.read",
        "payments.refund",
        "users.invite",
        "users.manage",
      ].sort(),
    );

    expect(grantsByRole.get("kitchen")).toEqual(
      [
        "menu.availability.manage",
        "menu.read",
        "orders.cancel",
        "orders.manage",
        "orders.read",
      ].sort(),
    );

    expect(grantsByRole.get("service")).toEqual(
      [
        "menu.availability.manage",
        "menu.read",
        "orders.cancel",
        "orders.manage",
        "orders.read",
      ].sort(),
    );

    expect(grantsByRole.get("marketing")).toEqual(
      ["analytics.read", "menu.publish", "menu.read"].sort(),
    );
  });

  it("grants Owner all permissions and denies Kitchen revenue/analytics reads", async () => {
    const kitchenUserId = randomUUID();
    fixture = await seedTwoTenantFixture(admin, {
      tenantA: {
        additionalMembers: [
          { userId: kitchenUserId, email: "kitchen@example.test", role: "staff" },
        ],
      },
    });
    const { tenantA } = fixture;
    await assignOnlySystemRole(kitchenUserId, tenantA.tenantId, "kitchen");

    const ownerRefund = await queryAsUser<{ has_tenant_permission: boolean }>(
      admin,
      tenantA.ownerId,
      `select has_tenant_permission($1, 'payments.refund')`,
      [tenantA.tenantId],
    );
    expect(ownerRefund.rows[0]?.has_tenant_permission).toBe(true);

    await admin.query(`insert into analytics_events (tenant_id, event_type) values ($1, $2)`, [
      tenantA.tenantId,
      "revenue.daily",
    ]);

    const kitchenAnalytics = await queryAsUser(
      admin,
      kitchenUserId,
      `select event_type from analytics_events where tenant_id = $1`,
      [tenantA.tenantId],
    );
    expect(kitchenAnalytics.rows).toHaveLength(0);
  });

  it("denies Marketing the payments.refund permission", async () => {
    const marketingUserId = randomUUID();
    fixture = await seedTwoTenantFixture(admin, {
      tenantA: {
        additionalMembers: [
          { userId: marketingUserId, email: "marketing@example.test", role: "staff" },
        ],
      },
    });
    const { tenantA } = fixture;
    await assignOnlySystemRole(marketingUserId, tenantA.tenantId, "marketing");

    await expect(
      queryAsUser(
        admin,
        marketingUserId,
        `select require_tenant_permission($1, 'payments.refund')`,
        [tenantA.tenantId],
      ),
    ).rejects.toThrow(/Missing permission payments\.refund|permission denied/i);
  });

  it("audits role permission and membership role changes made through authenticated access", async () => {
    const serviceUserId = randomUUID();
    fixture = await seedTwoTenantFixture(admin, {
      tenantA: {
        additionalMembers: [
          { userId: serviceUserId, email: "service@example.test", role: "staff" },
        ],
      },
    });
    const { tenantA } = fixture;

    const customRole = await queryAsUser<{ id: string }>(
      admin,
      tenantA.ownerId,
      `insert into roles (tenant_id, key, name, description, is_system)
       values ($1, $2, $3, $4, false)
       returning id`,
      [tenantA.tenantId, "expediter", "Expediter", "Expo station"],
    );
    const customRoleId = customRole.rows[0]?.id;

    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into role_permissions (role_id, permission_key) values ($1, 'orders.cancel')`,
      [customRoleId],
    );

    const membership = await admin.query<{ id: string }>(
      `select id from tenant_memberships where tenant_id = $1 and user_id = $2`,
      [tenantA.tenantId, serviceUserId],
    );

    await queryAsUser(
      admin,
      tenantA.ownerId,
      `insert into membership_roles (membership_id, role_id) values ($1, $2)`,
      [membership.rows[0]?.id, customRoleId],
    );

    const auditRows = await admin.query<{ target_type: string }>(
      `select target_type
         from audit_logs
        where tenant_id = $1
          and actor_user_id = $2
          and action = 'authorization.insert'
        order by created_at`,
      [tenantA.tenantId, tenantA.ownerId],
    );

    expect(auditRows.rows.map((row) => row.target_type)).toEqual([
      "role_permissions",
      "membership_roles",
    ]);
  });

  it("keeps at least one RBAC Owner role assignment per tenant", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;

    const ownerAssignment = await admin.query<{ membership_id: string; role_id: string }>(
      `select mr.membership_id, mr.role_id
         from membership_roles mr
         join roles r on r.id = mr.role_id
        where r.tenant_id = $1
          and r.key = 'owner'`,
      [tenantA.tenantId],
    );

    await admin.query("begin");
    await admin.query(`delete from membership_roles where membership_id = $1 and role_id = $2`, [
      ownerAssignment.rows[0]?.membership_id,
      ownerAssignment.rows[0]?.role_id,
    ]);
    await expect(admin.query("commit")).rejects.toThrow(/at least one Owner role assignment/i);

    const stillOwner = await admin.query(
      `select 1
         from membership_roles mr
         join roles r on r.id = mr.role_id
        where r.tenant_id = $1
          and r.key = 'owner'`,
      [tenantA.tenantId],
    );
    expect(stillOwner.rows).toHaveLength(1);
  });

  // Regression test for the Opus batch review (epic-3-5-batch, high,
  // privilege escalation): a users.manage holder (Manager) used to be able
  // to assign the system 'owner' role to their own membership, gaining
  // roles.manage/payments.refund etc. Assigning 'owner' now additionally
  // requires roles.manage.
  it("blocks a users.manage-only Manager from self-assigning the Owner role", async () => {
    const managerUserId = randomUUID();
    fixture = await seedTwoTenantFixture(admin, {
      tenantA: {
        additionalMembers: [
          { userId: managerUserId, email: "manager@example.test", role: "manager" },
        ],
      },
    });
    const { tenantA } = fixture;

    const canManageUsers = await queryAsUser<{ has_tenant_permission: boolean }>(
      admin,
      managerUserId,
      `select has_tenant_permission($1, 'users.manage')`,
      [tenantA.tenantId],
    );
    expect(canManageUsers.rows[0]?.has_tenant_permission).toBe(true);
    const canManageRoles = await queryAsUser<{ has_tenant_permission: boolean }>(
      admin,
      managerUserId,
      `select has_tenant_permission($1, 'roles.manage')`,
      [tenantA.tenantId],
    );
    expect(canManageRoles.rows[0]?.has_tenant_permission).toBe(false);

    const membership = await admin.query<{ id: string }>(
      `select id from tenant_memberships where tenant_id = $1 and user_id = $2`,
      [tenantA.tenantId, managerUserId],
    );
    const ownerRole = await admin.query<{ id: string }>(
      `select id from roles where tenant_id = $1 and key = 'owner'`,
      [tenantA.tenantId],
    );

    await expect(
      queryAsUser(
        admin,
        managerUserId,
        `insert into membership_roles (membership_id, role_id) values ($1, $2)`,
        [membership.rows[0]?.id, ownerRole.rows[0]?.id],
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);

    const escalated = await admin.query(
      `select 1 from membership_roles where membership_id = $1 and role_id = $2`,
      [membership.rows[0]?.id, ownerRole.rows[0]?.id],
    );
    expect(escalated.rows).toHaveLength(0);
  });

  it("blocks assigning a role across tenants", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;

    const tenantAMembership = await admin.query<{ id: string }>(
      `select id from tenant_memberships where tenant_id = $1 and user_id = $2`,
      [tenantA.tenantId, tenantA.ownerId],
    );
    const tenantBRole = await admin.query<{ id: string }>(
      `select id from roles where tenant_id = $1 and key = 'manager'`,
      [tenantB.tenantId],
    );

    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `insert into membership_roles (membership_id, role_id) values ($1, $2)`,
        [tenantAMembership.rows[0]?.id, tenantBRole.rows[0]?.id],
      ),
    ).rejects.toThrow(/same tenant|row-level security|permission denied/i);

    const leaked = await admin.query(
      `select 1 from membership_roles where membership_id = $1 and role_id = $2`,
      [tenantAMembership.rows[0]?.id, tenantBRole.rows[0]?.id],
    );
    expect(leaked.rows).toHaveLength(0);
  });
});
