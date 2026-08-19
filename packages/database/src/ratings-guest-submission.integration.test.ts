// Integration tests for `submit_order_rating()` / `get_tenant_rating_summary()`
// (Epic 10, ticket #33). Same DB-probe/skip pattern as the other database
// integration suites.
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { seedTwoTenantFixture, type TwoTenantFixture } from "@gastro-saas/testing";

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
      `[ratings-guest-submission.integration.test] no reachable Postgres at ${DB_URL}.`,
    );
  }
  console.warn(
    `[ratings-guest-submission.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Seeds an order directly in the given `status` (bypassing the full
 * checkout/kitchen-workflow state machine, out of this suite's own scope --
 * mirrors `mark-order-received-atomic.integration.test.ts`'s identical
 * shortcut) and returns the raw guest access token that unlocks it.
 */
async function seedOrder(
  admin: Client,
  tenantId: string,
  status: string,
  customerName = "Max Mustermann",
): Promise<{ orderId: string; rawToken: string }> {
  const orderId = randomUUID();
  const rawToken = randomUUID();

  await admin.query(
    `insert into orders (id, tenant_id, guest_access_token_hash, fulfillment_type, customer_name, currency, total_cents, status)
     values ($1, $2, $3, 'pickup', $4, 'EUR', 1500, $5)`,
    [orderId, tenantId, hashToken(rawToken), customerName, status],
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

interface RatingSummary {
  ratingCount: number;
  averageStars: number;
}

async function getTenantRatingSummary(admin: Client, tenantId: string): Promise<RatingSummary> {
  const result = await admin.query<{ get_tenant_rating_summary: RatingSummary }>(
    `select get_tenant_rating_summary($1) as get_tenant_rating_summary`,
    [tenantId],
  );
  return result.rows[0]!.get_tenant_rating_summary;
}

describe.skipIf(!dbAvailable)(
  "submit_order_rating() / get_tenant_rating_summary() (ticket #33)",
  () => {
    const admin = new Client({ connectionString: DB_URL });
    let fixture: TwoTenantFixture;

    beforeAll(async () => {
      await admin.connect();
    });

    afterEach(async () => {
      if (fixture) {
        // ratings -> orders (both `on delete cascade`/`restrict`-adjacent
        // tables owned by the tenant), mirroring the other order-adjacent
        // suites' cleanup ordering.
        await admin.query(`delete from ratings where tenant_id in ($1, $2)`, [
          fixture.tenantA.tenantId,
          fixture.tenantB.tenantId,
        ]);
        await admin.query(`delete from orders where tenant_id in ($1, $2)`, [
          fixture.tenantA.tenantId,
          fixture.tenantB.tenantId,
        ]);
      }
      await fixture?.cleanup();
    });

    afterAll(async () => {
      await admin.end();
    });

    it("rejects a wrong/guessed token (acceptance criterion 1)", async () => {
      fixture = await seedTwoTenantFixture(admin);
      await seedOrder(admin, fixture.tenantA.tenantId, "completed");

      await expect(submitRating(admin, randomUUID(), 5)).rejects.toThrow(/order not found/i);
    });

    it("rejects a malformed token hash the same way as any other miss", async () => {
      fixture = await seedTwoTenantFixture(admin);

      // The RPC validates hash shape before ever querying orders -- expect the
      // same generic rejection, not a distinguishable error.
      await expect(
        admin.query(`select submit_order_rating($1, $2, $3)`, ["not-a-real-hash", 5, ""]),
      ).rejects.toThrow(/order not found/i);
    });

    it("rejects rating an order that is not completed yet", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { rawToken } = await seedOrder(admin, fixture.tenantA.tenantId, "preparing");

      await expect(submitRating(admin, rawToken, 4)).rejects.toThrow(/not yet completed/i);
    });

    it("rejects an out-of-range stars value", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { rawToken } = await seedOrder(admin, fixture.tenantA.tenantId, "completed");

      await expect(submitRating(admin, rawToken, 6)).rejects.toThrow(/stars must be between/i);
      await expect(submitRating(admin, rawToken, 0)).rejects.toThrow(/stars must be between/i);
    });

    it("accepts a rating for a completed order and prevents a second rating for the same order (acceptance criterion 2)", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { orderId, rawToken } = await seedOrder(admin, fixture.tenantA.tenantId, "completed");

      const created = await submitRating(admin, rawToken, 5, "Fantastisch!");
      expect(created.stars).toBe(5);
      expect(created.comment).toBe("Fantastisch!");

      const row = await admin.query(`select order_id, stars, comment from ratings where id = $1`, [
        created.ratingId,
      ]);
      expect(row.rows[0]).toMatchObject({ order_id: orderId, stars: 5, comment: "Fantastisch!" });

      await expect(submitRating(admin, rawToken, 1, "Zweiter Versuch")).rejects.toThrow(
        /already been rated/i,
      );

      // Still exactly one rating row for this order.
      const count = await admin.query(`select count(*) from ratings where order_id = $1`, [
        orderId,
      ]);
      expect(Number(count.rows[0]!.count)).toBe(1);
    });

    it("aggregate rating updates correctly as ratings are added (acceptance criterion 3)", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const orderA = await seedOrder(admin, fixture.tenantA.tenantId, "completed", "Gast Eins");
      const orderB = await seedOrder(admin, fixture.tenantA.tenantId, "completed", "Gast Zwei");

      expect(await getTenantRatingSummary(admin, fixture.tenantA.tenantId)).toEqual({
        ratingCount: 0,
        averageStars: 0,
      });

      await submitRating(admin, orderA.rawToken, 4);
      expect(await getTenantRatingSummary(admin, fixture.tenantA.tenantId)).toEqual({
        ratingCount: 1,
        averageStars: 4,
      });

      await submitRating(admin, orderB.rawToken, 2);
      expect(await getTenantRatingSummary(admin, fixture.tenantA.tenantId)).toEqual({
        ratingCount: 2,
        averageStars: 3,
      });
    });

    it("cross-tenant isolation: a tenant's rating aggregate/rows never include another tenant's ratings", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA, tenantB } = fixture;
      const orderA = await seedOrder(admin, tenantA.tenantId, "completed", "Tenant A Gast");
      const orderB = await seedOrder(admin, tenantB.tenantId, "completed", "Tenant B Gast");

      await submitRating(admin, orderA.rawToken, 5, "Toll (Tenant A)");
      await submitRating(admin, orderB.rawToken, 1, "Schlecht (Tenant B)");

      expect(await getTenantRatingSummary(admin, tenantA.tenantId)).toEqual({
        ratingCount: 1,
        averageStars: 5,
      });
      expect(await getTenantRatingSummary(admin, tenantB.tenantId)).toEqual({
        ratingCount: 1,
        averageStars: 1,
      });

      const tenantARatings = await admin.query(
        `select tenant_id, comment from ratings where tenant_id = $1`,
        [tenantA.tenantId],
      );
      expect(tenantARatings.rows).toHaveLength(1);
      expect(tenantARatings.rows[0]!.comment).toBe("Toll (Tenant A)");
      expect(JSON.stringify(tenantARatings.rows)).not.toContain("Tenant B");
    });

    it("get_order_status_by_token reflects this order's own rating once submitted, and null before that", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { rawToken } = await seedOrder(admin, fixture.tenantA.tenantId, "completed");

      const beforeResult = await admin.query<{ get_order_status_by_token: { rating: unknown } }>(
        `select get_order_status_by_token($1) as get_order_status_by_token`,
        [hashToken(rawToken)],
      );
      expect(beforeResult.rows[0]!.get_order_status_by_token.rating).toBeNull();

      await submitRating(admin, rawToken, 4, "Gerne wieder");

      const afterResult = await admin.query<{
        get_order_status_by_token: { rating: { stars: number; comment: string } };
      }>(`select get_order_status_by_token($1) as get_order_status_by_token`, [
        hashToken(rawToken),
      ]);
      expect(afterResult.rows[0]!.get_order_status_by_token.rating).toMatchObject({
        stars: 4,
        comment: "Gerne wieder",
      });
    });
  },
);
