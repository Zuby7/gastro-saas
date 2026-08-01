// Integration test for the tenant/membership/brand/location RLS model
// introduced in ticket #4 (supabase/migrations/20260801040000_*.sql).
//
// This is a minimal, ad-hoc two-tenant RLS test written directly against
// Postgres (via `pg`), NOT the reusable cross-tenant test harness -- that
// harness is ticket #5's scope (`packages/testing`, not yet built) and is
// explicitly deferred there. This test exists so ticket #4's required test
// ("Integrationstest: RLS verweigert Zugriff auf fremden Tenant") is not
// skipped while waiting for #5.
//
// It requires a real local Supabase Postgres instance (`supabase start`,
// see supabase/config.toml). On this development machine that currently
// cannot be verified locally (Docker Desktop's containerd storage was
// corrupted by a full C: drive -- same known blocker as ticket #3, see
// PR #44 and docs/decisions/assumptions.md). The test therefore probes for
// a reachable database and skips (with a clear log message) if none is
// found, so `pnpm test` stays green on machines without the local stack.
// It is wired into `.github/workflows/migration-check.yml`, which runs a
// real `supabase start` on a GitHub-hosted runner and therefore actually
// exercises this test in CI.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

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
  // eslint-disable-next-line no-console
  console.warn(
    `[tenants.integration.test] Skipping: no reachable Postgres at ${DB_URL}. ` +
      "Run `pnpm --filter @gastro-saas/database db:start` (requires a working " +
      "local Docker setup) to exercise this test locally, or rely on the " +
      "migration-check CI workflow, which runs it against a real GitHub-hosted runner.",
  );
}

/** Runs a query as a simulated authenticated Supabase user (RLS-enforced). */
async function queryAsUser(client: Client, userId: string, sql: string, params: unknown[] = []) {
  await client.query("set role authenticated");
  // `SET` does not accept bound parameters, so the JWT claims are passed via
  // `set_config`, which is a normal (parameterizable) function call and is
  // what `auth.uid()` reads from under the hood on the local Supabase stack.
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  try {
    return await client.query(sql, params);
  } finally {
    await client.query("reset role");
  }
}

describe.skipIf(!dbAvailable)("tenant/membership/brand/location RLS", () => {
  const admin = new Client({ connectionString: DB_URL });

  const tenantAId = randomUUID();
  const tenantBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const brandAId = randomUUID();
  const locationBId = randomUUID();

  beforeAll(async () => {
    await admin.connect();

    // Seed fixtures directly as the table owner (bypasses RLS by design --
    // equivalent to what a service_role connection or a migration/seed
    // script would do). Mirrors two tenants with similarly-shaped data, per
    // docs/security/tenant-isolation.md's cross-tenant testing requirement.
    await admin.query(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [
      userAId,
      "owner-a@example.test",
      userBId,
      "owner-b@example.test",
    ]);

    await admin.query(`insert into tenants (id, name, slug) values ($1, $2, $3), ($4, $5, $6)`, [
      tenantAId,
      "Trattoria Da Mario",
      `trattoria-da-mario-${tenantAId.slice(0, 8)}`,
      tenantBId,
      "Burger Barn",
      `burger-barn-${tenantBId.slice(0, 8)}`,
    ]);

    await admin.query(
      `insert into tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner'), ($3, $4, 'owner')`,
      [tenantAId, userAId, tenantBId, userBId],
    );

    await admin.query(`insert into brands (id, tenant_id, name, slug) values ($1, $2, $3, $4)`, [
      brandAId,
      tenantAId,
      "Mario Group",
      `mario-group-${brandAId.slice(0, 8)}`,
    ]);

    await admin.query(`insert into locations (id, tenant_id, name, slug) values ($1, $2, $3, $4)`, [
      locationBId,
      tenantBId,
      "Burger Barn Downtown",
      `burger-barn-downtown-${locationBId.slice(0, 8)}`,
    ]);
  });

  afterAll(async () => {
    // Clean up regardless of test outcome; cascades remove memberships/brands/locations.
    await admin.query(`delete from tenants where id in ($1, $2)`, [tenantAId, tenantBId]);
    await admin.query(`delete from auth.users where id in ($1, $2)`, [userAId, userBId]);
    await admin.end();
  });

  it("lets a tenant member read their own tenant, not the other tenant", async () => {
    const result = await queryAsUser(admin, userAId, `select id from tenants order by id`);
    const ids = result.rows.map((row: { id: string }) => row.id);
    expect(ids).toContain(tenantAId);
    expect(ids).not.toContain(tenantBId);
  });

  it("never returns another tenant's membership rows", async () => {
    const result = await queryAsUser(
      admin,
      userAId,
      `select tenant_id, user_id from tenant_memberships order by tenant_id`,
    );
    const tenantIds = result.rows.map((row: { tenant_id: string }) => row.tenant_id);
    expect(tenantIds.every((id: string) => id === tenantAId)).toBe(true);
  });

  it("never returns another tenant's brands, even when queried by id", async () => {
    const result = await queryAsUser(admin, userAId, `select id from brands where tenant_id = $1`, [
      tenantAId,
    ]);
    expect(result.rows.map((row: { id: string }) => row.id)).toContain(brandAId);

    const crossTenantAttempt = await queryAsUser(
      admin,
      userAId,
      `select id from locations where tenant_id = $1`,
      [tenantBId],
    );
    expect(crossTenantAttempt.rows).toHaveLength(0);
  });

  it("denies inserting a brand into a tenant the user is not a member of", async () => {
    await expect(
      queryAsUser(
        admin,
        userAId,
        `insert into brands (tenant_id, name, slug) values ($1, 'Hostile Insert', 'hostile-insert')`,
        [tenantBId],
      ),
    ).rejects.toThrow(/row-level security|permission denied/i);
  });

  it("denies updating another tenant's location", async () => {
    const result = await queryAsUser(
      admin,
      userAId,
      `update locations set name = 'Hacked' where id = $1 returning id`,
      [locationBId],
    );
    // RLS's USING clause filters the row out entirely rather than erroring --
    // zero rows affected, not an exception.
    expect(result.rows).toHaveLength(0);

    const stillIntact = await admin.query(`select name from locations where id = $1`, [
      locationBId,
    ]);
    expect(stillIntact.rows[0]?.name).toBe("Burger Barn Downtown");
  });

  it("keeps at least one Owner per tenant: removing the last Owner is rejected at commit", async () => {
    await admin.query("begin");
    await admin.query(`delete from tenant_memberships where tenant_id = $1 and role = 'owner'`, [
      tenantBId,
    ]);
    await expect(admin.query("commit")).rejects.toThrow(/at least one Owner/i);

    // Connection remains usable after the implicit rollback caused by the
    // failed deferred-constraint commit.
    const membership = await admin.query(
      `select role from tenant_memberships where tenant_id = $1 and user_id = $2`,
      [tenantBId, userBId],
    );
    expect(membership.rows[0]?.role).toBe("owner");
  });

  it("allows swapping Owners within a single transaction (deferred check passes at commit)", async () => {
    const replacementOwnerId = randomUUID();
    await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [
      replacementOwnerId,
      "replacement-owner-b@example.test",
    ]);

    await admin.query("begin");
    await admin.query(
      `insert into tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`,
      [tenantBId, replacementOwnerId],
    );
    await admin.query(
      `delete from tenant_memberships where tenant_id = $1 and user_id = $2 and role = 'owner'`,
      [tenantBId, userBId],
    );
    await admin.query("commit");

    const owners = await admin.query(
      `select user_id from tenant_memberships where tenant_id = $1 and role = 'owner'`,
      [tenantBId],
    );
    expect(owners.rows.map((row: { user_id: string }) => row.user_id)).toEqual([
      replacementOwnerId,
    ]);

    // Restore userB as Owner so afterAll's cleanup/other tests aren't affected.
    await admin.query(
      `insert into tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner')`,
      [tenantBId, userBId],
    );
    await admin.query(`delete from auth.users where id = $1`, [replacementOwnerId]);
  });
});
