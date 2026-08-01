// Reusable two-tenant cross-isolation test harness (ticket #5).
//
// This generalizes the ad-hoc pattern written directly in
// `packages/database/src/tenants.integration.test.ts` (ticket #4) into a
// shared abstraction so every future ticket touching a tenant-scoped table
// can seed two tenants and assert cross-tenant denial without re-deriving
// the `set role authenticated` / `set_config('request.jwt.claims', ...)`
// simulation of `auth.uid()` from scratch.
//
// Explicitly NOT dependent on Epic 3 (auth): sessions are simulated directly
// at the DB/JWT-claims level via `set_config`, exactly like ticket #4's test
// did -- there is no real login flow, token issuance, or Supabase Auth API
// call involved. This is intentional per ticket #5's scope.
//
// Explicit non-goal: no UI tests. This harness only exercises Postgres RLS
// directly via `pg`; it says nothing about server-side authorization checks
// or UI behavior (see docs/security/tenant-isolation.md Layer 1 for that).
import { randomUUID } from "node:crypto";
import type { Client, QueryResult, QueryResultRow } from "pg";
import { expect } from "vitest";

/** A single seeded tenant: its id, its first Owner's user id, and identity fields. */
export interface FixtureTenant {
  tenantId: string;
  ownerId: string;
  ownerEmail: string;
  name: string;
  slug: string;
}

/** Extra membership to seed alongside a tenant's Owner (e.g. for role/permission tests). */
export interface FixtureMember {
  userId?: string;
  email?: string;
  role: "owner" | "manager" | "staff";
}

export interface FixtureTenantOptions {
  tenantId?: string;
  name?: string;
  slug?: string;
  ownerId?: string;
  ownerEmail?: string;
  /** Additional memberships to seed for this tenant, beyond the required Owner. */
  additionalMembers?: FixtureMember[];
}

export interface SeedTwoTenantFixtureOptions {
  tenantA?: FixtureTenantOptions;
  tenantB?: FixtureTenantOptions;
}

export interface TwoTenantFixture {
  tenantA: FixtureTenant;
  tenantB: FixtureTenant;
  /** Deletes every row this fixture created (tenants cascade to memberships/brands/locations/etc; auth.users deleted explicitly). */
  cleanup(): Promise<void>;
}

interface ResolvedTenantSeed {
  tenantId: string;
  ownerId: string;
  ownerEmail: string;
  name: string;
  slug: string;
  additionalMembers: Required<Pick<FixtureMember, "userId" | "email" | "role">>[];
}

function resolveTenantSeed(
  label: "a" | "b",
  options: FixtureTenantOptions = {},
): ResolvedTenantSeed {
  const tenantId = options.tenantId ?? randomUUID();
  const shortId = tenantId.slice(0, 8);
  return {
    tenantId,
    ownerId: options.ownerId ?? randomUUID(),
    ownerEmail: options.ownerEmail ?? `owner-${label}-${shortId}@example.test`,
    name: options.name ?? `Fixture Tenant ${label.toUpperCase()} ${shortId}`,
    slug: options.slug ?? `fixture-tenant-${label}-${shortId}`,
    additionalMembers: (options.additionalMembers ?? []).map((member, index) => ({
      userId: member.userId ?? randomUUID(),
      email: member.email ?? `member-${label}-${index}-${shortId}@example.test`,
      role: member.role,
    })),
  };
}

/**
 * Seeds two tenants, each with one Owner membership (satisfying the "every
 * tenant has at least one Owner" DB invariant from
 * supabase/migrations/20260801040000_tenant_membership_brand_location_model.sql),
 * plus any `additionalMembers` requested. Mirrors two tenants with similar
 * shapes per docs/security/tenant-isolation.md's cross-tenant testing
 * requirement.
 *
 * `admin` must be a connected `pg.Client` with enough privilege to bypass RLS
 * (the table owner / a role equivalent to what a `service_role` connection or
 * a migration/seed script would use) -- exactly as ticket #4's ad-hoc test
 * did. Seeding intentionally happens outside RLS: it represents trusted
 * setup, not the behavior under test.
 */
export async function seedTwoTenantFixture(
  admin: Client,
  options: SeedTwoTenantFixtureOptions = {},
): Promise<TwoTenantFixture> {
  const tenantA = resolveTenantSeed("a", options.tenantA);
  const tenantB = resolveTenantSeed("b", options.tenantB);

  const allUsers = [
    { id: tenantA.ownerId, email: tenantA.ownerEmail },
    { id: tenantB.ownerId, email: tenantB.ownerEmail },
    ...tenantA.additionalMembers.map((m) => ({ id: m.userId, email: m.email })),
    ...tenantB.additionalMembers.map((m) => ({ id: m.userId, email: m.email })),
  ];

  for (const user of allUsers) {
    await admin.query(`insert into auth.users (id, email) values ($1, $2)`, [user.id, user.email]);
  }

  // A tenant must be created together with its first Owner membership in the
  // same transaction -- `tenants_created_with_owner` (a deferred constraint
  // trigger) asserts at commit that every tenant has at least one Owner.
  await admin.query("begin");
  try {
    await admin.query(`insert into tenants (id, name, slug) values ($1, $2, $3), ($4, $5, $6)`, [
      tenantA.tenantId,
      tenantA.name,
      tenantA.slug,
      tenantB.tenantId,
      tenantB.name,
      tenantB.slug,
    ]);

    await admin.query(
      `insert into tenant_memberships (tenant_id, user_id, role) values ($1, $2, 'owner'), ($3, $4, 'owner')`,
      [tenantA.tenantId, tenantA.ownerId, tenantB.tenantId, tenantB.ownerId],
    );

    for (const member of [...tenantA.additionalMembers, ...tenantB.additionalMembers]) {
      const tenantId = tenantA.additionalMembers.includes(member)
        ? tenantA.tenantId
        : tenantB.tenantId;
      await admin.query(
        `insert into tenant_memberships (tenant_id, user_id, role) values ($1, $2, $3)`,
        [tenantId, member.userId, member.role],
      );
    }

    await admin.query("commit");
  } catch (error) {
    await admin.query("rollback").catch(() => undefined);
    throw error;
  }

  const allUserIds = allUsers.map((u) => u.id);

  return {
    tenantA: {
      tenantId: tenantA.tenantId,
      ownerId: tenantA.ownerId,
      ownerEmail: tenantA.ownerEmail,
      name: tenantA.name,
      slug: tenantA.slug,
    },
    tenantB: {
      tenantId: tenantB.tenantId,
      ownerId: tenantB.ownerId,
      ownerEmail: tenantB.ownerEmail,
      name: tenantB.name,
      slug: tenantB.slug,
    },
    async cleanup() {
      // Deleting the tenants cascades to tenant_memberships and any
      // tenant-scoped rows (brands, locations, ...) a test seeded on top of
      // this fixture. auth.users rows are not owned by `tenants` and must be
      // removed explicitly.
      await admin.query(`delete from tenants where id in ($1, $2)`, [
        tenantA.tenantId,
        tenantB.tenantId,
      ]);
      await admin.query(`delete from auth.users where id = any($1::uuid[])`, [allUserIds]);
    },
  };
}

/**
 * Runs `sql` against `client` as a simulated authenticated Supabase session
 * for `userId` -- `set role authenticated` plus `set_config('request.jwt.claims', ...)`,
 * which is what `auth.uid()` reads from on the local Supabase stack. This is
 * the same technique ticket #4's ad-hoc test used, extracted for reuse.
 *
 * Per ticket #5's scope, this simulates a session directly at the DB/JWT
 * level and is intentionally not dependent on a real Supabase Auth login
 * flow (Epic 3).
 */
export async function queryAsUser<Row extends QueryResultRow = QueryResultRow>(
  client: Client,
  userId: string,
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<Row>> {
  await client.query("set role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  try {
    return await client.query<Row>(sql, params);
  } finally {
    // `request.jwt.claims` is set session-scoped (the `false` argument above),
    // not transaction-local, so it survives past this call on `client`. Clear
    // it here too -- otherwise a later query on the same `client` that forgets
    // to go through `queryAsUser` again could silently keep acting as this
    // simulated user instead of falling back to no identity.
    await client.query("select set_config('request.jwt.claims', NULL, false)");
    await client.query("reset role");
  }
}

export interface ExpectCrossTenantDeniedOptions {
  /** A connected `pg.Client` to run the query against. */
  client: Client;
  /** The user id whose session should be denied access -- typically a member of the "wrong" tenant. */
  actorUserId: string;
  /** The SQL to attempt against the other tenant's row(s). */
  sql: string;
  /** Bound parameters for `sql`. */
  params?: unknown[];
}

/**
 * Asserts that a query attempting to read or write another tenant's row(s),
 * run as `actorUserId` (simulated via {@link queryAsUser}), is denied by RLS.
 *
 * Postgres RLS denies access in one of two shapes, both accepted here as
 * "denied" (mirroring the two outcomes ticket #4's test had to distinguish
 * by hand):
 *
 * - A `SELECT`/`UPDATE`/`DELETE` whose `USING` clause filters out the target
 *   row(s) entirely: the query succeeds but returns/affects zero rows.
 * - An `INSERT` (or other statement) whose `WITH CHECK` clause rejects the
 *   attempted row: the query throws a "row-level security" / "permission
 *   denied" error.
 *
 * Fails the test if the query instead returns/affects one or more rows
 * belonging to the other tenant, or throws an unrelated error.
 *
 * **Known limitations, please read before use:**
 *
 * - For `UPDATE`/`DELETE`/`INSERT` **without** a `RETURNING` clause, `pg`
 *   always returns `rows: []` regardless of how many rows were actually
 *   affected -- `rows.length` alone cannot tell "denied" apart from "silently
 *   mutated N rows of someone else's data". This helper therefore also checks
 *   `result.rowCount`, which `pg` populates correctly from the server's
 *   command tag even without `RETURNING`. Callers doing DML should still
 *   prefer adding `RETURNING id` to `sql` where practical -- it gives the
 *   clearest, most direct signal and lets a failure message show which row(s)
 *   leaked.
 * - A `SELECT count(*)` style query always returns exactly one row (the
 *   count itself), which this helper would misreport as "not denied" even if
 *   the count is 0. Don't pass aggregate queries to this helper -- select the
 *   underlying rows directly instead. Not solved here; documented as a known
 *   gap.
 * - A "permission denied" / "row-level security" error only proves *some*
 *   policy or grant rejected the statement -- it does not by itself prove
 *   the *intended* tenant-scoping policy is what did the rejecting (e.g. a
 *   missing `GRANT` to the `authenticated` role would also throw "permission
 *   denied" and be indistinguishable from a working RLS policy here).
 *
 * Usage:
 * ```ts
 * await expectCrossTenantDenied({
 *   client: admin,
 *   actorUserId: tenantA.ownerId,
 *   sql: "select id from locations where tenant_id = $1",
 *   params: [tenantB.tenantId],
 * });
 * ```
 */
export async function expectCrossTenantDenied(
  options: ExpectCrossTenantDeniedOptions,
): Promise<void> {
  const { client, actorUserId, sql, params = [] } = options;

  // Only a failure of the *database query itself* (e.g. a real RLS/grant
  // denial thrown by Postgres) should be caught and re-interpreted below.
  // The assertions that follow a successful query must be allowed to throw
  // (and propagate) their own AssertionError directly -- catching them here
  // and re-matching the message against the RLS-error regex would mask the
  // real diagnosis, and (in the worst case) could make a genuine assertion
  // failure misreport as a pass if its message ever happened to contain
  // "permission denied".
  let result: QueryResult<QueryResultRow>;
  try {
    result = await queryAsUser(client, actorUserId, sql, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message, `expected an RLS denial error, got: ${message}`).toMatch(
      /row-level security|permission denied/i,
    );
    return;
  }

  // See the "Known limitations" note above `rowCount` for why both checks
  // are required: `rows.length` alone is vacuous for DML without RETURNING.
  expect(
    result.rows.length === 0 && (result.rowCount ?? 0) === 0,
    "expected cross-tenant query to be denied by RLS (return/affect zero rows), " +
      `but it returned ${result.rows.length} row(s) and affected rowCount=${result.rowCount} ` +
      "belonging to another tenant",
  ).toBe(true);
}
