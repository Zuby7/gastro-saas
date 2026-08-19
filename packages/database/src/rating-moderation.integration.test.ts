// Integration tests for the rating moderation queue (Epic 10, ticket #34):
// the `reviews.read`/`reviews.moderate` permissions, the configurable
// initial moderation status, `moderate_rating()`, `list_tenant_ratings_for_moderation()`,
// and its audit trail. Same DB-probe/skip pattern as the other database
// integration suites.
import { createHash, randomUUID } from "node:crypto";
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
      `[rating-moderation.integration.test] CI or SUPABASE_DB_URL is set, but no reachable ` +
        `Postgres was found at ${DB_URL}. Refusing to silently skip the rating moderation ` +
        "tenant-isolation/permission-boundary suite in CI.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[rating-moderation.integration.test] Skipping: no reachable Postgres at ${DB_URL}. Run ` +
      "`pnpm --filter @gastro-saas/database db:start` to exercise this test locally.",
  );
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function seedOrder(
  admin: Client,
  tenantId: string,
  customerName = "Max Mustermann",
): Promise<{ orderId: string; rawToken: string }> {
  const orderId = randomUUID();
  const rawToken = randomUUID();

  await admin.query(
    `insert into orders (id, tenant_id, guest_access_token_hash, fulfillment_type, customer_name, currency, total_cents, status)
     values ($1, $2, $3, 'pickup', $4, 'EUR', 1500, 'completed')`,
    [orderId, tenantId, hashToken(rawToken), customerName],
  );

  return { orderId, rawToken };
}

interface SubmitRatingResult {
  ratingId: string;
  stars: number;
  comment: string;
  createdAt: string;
}

async function submitRating(
  admin: Client,
  rawToken: string,
  stars: number,
  comment = "",
): Promise<SubmitRatingResult> {
  const result = await admin.query<{ submit_order_rating: SubmitRatingResult }>(
    `select submit_order_rating($1, $2, $3) as submit_order_rating`,
    [hashToken(rawToken), stars, comment],
  );
  return result.rows[0]!.submit_order_rating;
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

describe.skipIf(!dbAvailable)("rating moderation queue (ticket #34, risk:tenant-isolation)", () => {
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
      await admin.query(`delete from ratings where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
      await admin.query(`delete from orders where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
      await admin.query(
        `update restaurant_profiles set default_rating_moderation_status = 'pending' where tenant_id in ($1, $2)`,
        [fixture.tenantA.tenantId, fixture.tenantB.tenantId],
      );
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
    // A `restaurant_profiles` row is required for the default-status
    // lookup -- create_rating_moderation_row() coalesces to 'pending' if
    // missing, but most of these tests want an explicit, known row.
    await admin.query(
      `insert into restaurant_profiles (tenant_id, display_name) values ($1, 'Fixture A'), ($2, 'Fixture B')`,
      [seeded.tenantA.tenantId, seeded.tenantB.tenantId],
    );
    return { fixture: seeded, staffAId, staffBId };
  }

  it("Owner/Manager system roles hold reviews.read/reviews.moderate by default; Kitchen/Service/Marketing do not", async () => {
    const seed = await seedFixtureWithStaff();
    fixture = seed.fixture;

    const grants = await admin.query<{ key: string; permission_key: string }>(
      `select r.key, rp.permission_key
           from roles r
           join role_permissions rp on rp.role_id = r.id
          where r.tenant_id = $1
            and rp.permission_key in ('reviews.read', 'reviews.moderate')
          order by r.key, rp.permission_key`,
      [fixture.tenantA.tenantId],
    );

    expect(grants.rows.map((r) => `${r.key}:${r.permission_key}`)).toEqual([
      "manager:reviews.moderate",
      "manager:reviews.read",
      "owner:reviews.moderate",
      "owner:reviews.read",
    ]);
  });

  it("acceptance criterion 1: a new rating starts in the tenant's configured default moderation status", async () => {
    const seed = await seedFixtureWithStaff();
    fixture = seed.fixture;

    const { rawToken: tokenPending } = await seedOrder(admin, fixture.tenantA.tenantId);
    const pendingRating = await submitRating(admin, tokenPending, 5, "Erste Bewertung");
    const pendingRow = await admin.query<{ status: string }>(
      `select status from rating_moderation where rating_id = $1`,
      [pendingRating.ratingId],
    );
    expect(pendingRow.rows[0]!.status).toBe("pending");

    await admin.query(
      `update restaurant_profiles set default_rating_moderation_status = 'released' where tenant_id = $1`,
      [fixture.tenantA.tenantId],
    );

    const { rawToken: tokenReleased } = await seedOrder(
      admin,
      fixture.tenantA.tenantId,
      "Zweiter Gast",
    );
    const releasedRating = await submitRating(admin, tokenReleased, 4, "Zweite Bewertung");
    const releasedRow = await admin.query<{ status: string }>(
      `select status from rating_moderation where rating_id = $1`,
      [releasedRating.ratingId],
    );
    expect(releasedRow.rows[0]!.status).toBe("released");
  });

  describe("moderate_rating: permission boundary (acceptance criterion 2)", () => {
    it("a Manager (reviews.moderate) can change a rating's moderation status", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
      const { rawToken } = await seedOrder(admin, fixture.tenantA.tenantId);
      const rating = await submitRating(admin, rawToken, 3, "Geht so");

      const result = await queryAsUser(
        admin,
        seed.staffAId,
        `select moderate_rating($1, $2, 'released') ->> 'status' as status`,
        [fixture.tenantA.tenantId, rating.ratingId],
      );
      expect(result.rows[0]!.status).toBe("released");

      const row = await admin.query<{ status: string; moderated_by_user_id: string }>(
        `select status, moderated_by_user_id from rating_moderation where rating_id = $1`,
        [rating.ratingId],
      );
      expect(row.rows[0]).toMatchObject({
        status: "released",
        moderated_by_user_id: seed.staffAId,
      });
    });

    it("denies a member without reviews.moderate (Service) from changing a rating's status -- the explicit denial test", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "service");
      const { rawToken } = await seedOrder(admin, fixture.tenantA.tenantId);
      const rating = await submitRating(admin, rawToken, 2, "Nicht so gut");

      await expect(
        queryAsUser(admin, seed.staffAId, `select moderate_rating($1, $2, 'hidden')`, [
          fixture.tenantA.tenantId,
          rating.ratingId,
        ]),
      ).rejects.toThrow(/insufficient_privilege|Missing permission/i);

      const row = await admin.query<{ status: string }>(
        `select status from rating_moderation where rating_id = $1`,
        [rating.ratingId],
      );
      expect(row.rows[0]!.status).toBe("pending");
    });

    it("that same Service member is also denied reviews.read for the moderation list", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "service");
      const { rawToken } = await seedOrder(admin, fixture.tenantA.tenantId);
      await submitRating(admin, rawToken, 4, "Nett");

      await expect(
        queryAsUser(admin, seed.staffAId, `select list_tenant_ratings_for_moderation($1)`, [
          fixture.tenantA.tenantId,
        ]),
      ).rejects.toThrow(/insufficient_privilege|Missing permission/i);

      // Direct SELECT is denied too (RLS backstop, not just the RPC check).
      const directSelect = await queryAsUser(
        admin,
        seed.staffAId,
        `select id from ratings where tenant_id = $1`,
        [fixture.tenantA.tenantId],
      );
      expect(directSelect.rows).toHaveLength(0);
    });
  });

  describe("cross-tenant isolation", () => {
    it("never lets a Manager of tenant A moderate tenant B's rating", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
      await reassignToRole(admin, fixture.tenantB.tenantId, seed.staffBId, "manager");
      const { rawToken } = await seedOrder(admin, fixture.tenantB.tenantId, "Tenant B Gast");
      const ratingB = await submitRating(admin, rawToken, 5, "Tenant B Bewertung");

      // Tenant A's own tenant_id, tenant B's rating id: moderate_rating()'s
      // own `tenant_id = p_tenant_id` filter finds no matching row.
      await expect(
        queryAsUser(admin, seed.staffAId, `select moderate_rating($1, $2, 'hidden')`, [
          fixture.tenantA.tenantId,
          ratingB.ratingId,
        ]),
      ).rejects.toThrow(/Rating not found/i);

      const unchanged = await admin.query<{ status: string }>(
        `select status from rating_moderation where rating_id = $1`,
        [ratingB.ratingId],
      );
      expect(unchanged.rows[0]!.status).toBe("pending");

      // Sanity check: tenant B's own Manager can moderate it.
      const asTenantBManager = await queryAsUser(
        admin,
        seed.staffBId,
        `select moderate_rating($1, $2, 'hidden') ->> 'status' as status`,
        [fixture.tenantB.tenantId, ratingB.ratingId],
      );
      expect(asTenantBManager.rows[0]!.status).toBe("hidden");
    });

    it("never leaks tenant B's ratings/moderation rows to tenant A's Manager via a plain SELECT either", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
      const { rawToken } = await seedOrder(admin, fixture.tenantB.tenantId, "Tenant B Gast");
      const ratingB = await submitRating(admin, rawToken, 3, "Tenant B geheim");

      await expectCrossTenantDenied({
        client: admin,
        actorUserId: seed.staffAId,
        sql: `select id from ratings where id = $1`,
        params: [ratingB.ratingId],
      });

      await expectCrossTenantDenied({
        client: admin,
        actorUserId: seed.staffAId,
        sql: `select id from rating_moderation where rating_id = $1`,
        params: [ratingB.ratingId],
      });

      // list_tenant_ratings_for_moderation() called with A's own tenant id
      // never surfaces B's rating either.
      const list = await queryAsUser(
        admin,
        seed.staffAId,
        `select rating_id from list_tenant_ratings_for_moderation($1)`,
        [fixture.tenantA.tenantId],
      );
      expect(list.rows.map((r) => r.rating_id)).not.toContain(ratingB.ratingId);
    });
  });

  describe("observability: moderation decisions are audited", () => {
    it("appends an audit_logs row when a rating's moderation status changes", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
      const { rawToken } = await seedOrder(admin, fixture.tenantA.tenantId);
      const rating = await submitRating(admin, rawToken, 1, "Enttäuschend");

      await queryAsUser(admin, seed.staffAId, `select moderate_rating($1, $2, 'hidden')`, [
        fixture.tenantA.tenantId,
        rating.ratingId,
      ]);

      const logs = await admin.query<{
        action: string;
        actor_user_id: string;
        target_type: string;
        metadata: { ratingId: string; fromStatus: string; toStatus: string };
      }>(
        `select action, actor_user_id, target_type, metadata
             from audit_logs
            where tenant_id = $1
              and action = 'reviews.moderation_status_changed'`,
        [fixture.tenantA.tenantId],
      );

      expect(logs.rows).toHaveLength(1);
      expect(logs.rows[0]).toMatchObject({
        actor_user_id: seed.staffAId,
        target_type: "rating_moderation",
      });
      expect(logs.rows[0]!.metadata).toMatchObject({
        ratingId: rating.ratingId,
        fromStatus: "pending",
        toStatus: "hidden",
      });
    });

    it("does not append a redundant audit_logs row when the status is set to its current value", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
      const { rawToken } = await seedOrder(admin, fixture.tenantA.tenantId);
      const rating = await submitRating(admin, rawToken, 4, "Okay");

      // No-op transition: pending -> pending.
      await queryAsUser(admin, seed.staffAId, `select moderate_rating($1, $2, 'pending')`, [
        fixture.tenantA.tenantId,
        rating.ratingId,
      ]);

      const logs = await admin.query(
        `select id from audit_logs
            where tenant_id = $1
              and action = 'reviews.moderation_status_changed'`,
        [fixture.tenantA.tenantId],
      );
      expect(logs.rows).toHaveLength(0);
    });
  });

  it("rejects an invalid moderation status", async () => {
    const seed = await seedFixtureWithStaff();
    fixture = seed.fixture;
    await reassignToRole(admin, fixture.tenantA.tenantId, seed.staffAId, "manager");
    const { rawToken } = await seedOrder(admin, fixture.tenantA.tenantId);
    const rating = await submitRating(admin, rawToken, 4, "Okay");

    await expect(
      queryAsUser(admin, seed.staffAId, `select moderate_rating($1, $2, 'not-a-real-status')`, [
        fixture.tenantA.tenantId,
        rating.ratingId,
      ]),
    ).rejects.toThrow(/Invalid moderation status/i);
  });
});
