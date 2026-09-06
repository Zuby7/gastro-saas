// Integration tests for `record_dish_view()`/`record_add_to_cart_event()`
// (ticket #120 part B, "Öffentliche Speisekarte: dish_view/add_to_cart
// Event-Instrumentierung" -- see
// supabase/migrations/20260906090000_dish_view_and_add_to_cart_analytics.sql).
//
// Mirrors packages/database/src/menu-view-analytics.integration.test.ts
// (ticket #67) exactly, proving the same three properties for each of the
// two new event types:
// - Dedup: repeated calls for the same (tenant, dish, event_type, session,
//   UTC day) produce exactly one analytics_events row.
// - Independent counting: a different session, or the same session on a
//   different day, each counts separately.
// - Rate limiting: a burst of rapid calls from the same (tenant, ip_hash)
//   bucket, even across many distinct sessions, is capped.
// Plus a cross-tenant test proving a dish id from one tenant is rejected
// outright when passed alongside another tenant's tenant_id (never
// attributed to the wrong tenant), and that the same raw session token
// never leaks a dedup across two tenants.
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
      `[dish-engagement-analytics.integration.test] no reachable Postgres at ${DB_URL}.`,
    );
  }
  console.warn(
    `[dish-engagement-analytics.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Seeds a single published dish for `tenantId` -- same shape as dish-performance-stats.integration.test.ts's seedPublishedMenu, trimmed to one dish. */
async function seedPublishedDish(admin: Client, tenantId: string): Promise<string> {
  const menuVersionId = randomUUID();
  const categoryId = randomUUID();
  const dishId = randomUUID();

  await admin.query(`insert into menu_versions (id, tenant_id, status) values ($1, $2, 'draft')`, [
    menuVersionId,
    tenantId,
  ]);
  await admin.query(
    `insert into categories (id, tenant_id, menu_version_id, name, sort_order) values ($1, $2, $3, 'Pizza', 1)`,
    [categoryId, tenantId, menuVersionId],
  );
  await admin.query(
    `insert into dishes (id, tenant_id, menu_version_id, category_id, name, price_cents, allergen_reviewed)
     values ($1, $2, $3, $4, 'Margherita', 1000, true)`,
    [dishId, tenantId, menuVersionId, categoryId],
  );
  await admin.query(
    `update menu_versions set status = 'published', published_at = now() where id = $1`,
    [menuVersionId],
  );

  return dishId;
}

describe.skipIf(!dbAvailable)(
  "record_dish_view / record_add_to_cart_event (ticket #120 part B)",
  () => {
    let admin: Client;
    let fixture: TwoTenantFixture;

    beforeAll(async () => {
      admin = new Client({ connectionString: DB_URL });
      await admin.connect();
    });

    afterAll(async () => {
      await admin.end();
    });

    afterEach(async () => {
      await fixture?.cleanup();
    });

    async function recordDishView(
      tenantId: string,
      dishId: string,
      sessionTokenHash: string,
      ipHash: string,
    ) {
      const result = await admin.query<{ record_dish_view: boolean }>(
        `select record_dish_view($1, $2, $3, $4) as record_dish_view`,
        [tenantId, dishId, sessionTokenHash, ipHash],
      );
      return result.rows[0]!.record_dish_view;
    }

    async function recordAddToCart(
      tenantId: string,
      dishId: string,
      sessionTokenHash: string,
      ipHash: string,
    ) {
      const result = await admin.query<{ record_add_to_cart_event: boolean }>(
        `select record_add_to_cart_event($1, $2, $3, $4) as record_add_to_cart_event`,
        [tenantId, dishId, sessionTokenHash, ipHash],
      );
      return result.rows[0]!.record_add_to_cart_event;
    }

    async function countEvents(tenantId: string, eventType: string): Promise<number> {
      const result = await admin.query<{ c: string }>(
        `select count(*)::int as c from analytics_events where tenant_id = $1 and event_type = $2`,
        [tenantId, eventType],
      );
      return Number(result.rows[0]!.c);
    }

    describe("record_dish_view", () => {
      it("dedupes repeated calls for the same tenant+dish+session+day into exactly one event", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA } = fixture;
        const dishId = await seedPublishedDish(admin, tenantA.tenantId);
        const sessionHash = hash(`session-${randomUUID()}`);
        const ipHash = hash("203.0.113.20");

        const first = await recordDishView(tenantA.tenantId, dishId, sessionHash, ipHash);
        const second = await recordDishView(tenantA.tenantId, dishId, sessionHash, ipHash);

        expect(first).toBe(true);
        expect(second).toBe(false);
        expect(await countEvents(tenantA.tenantId, "dish_view")).toBe(1);
      });

      it("counts a different session for the same tenant+dish as an independent event", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA } = fixture;
        const dishId = await seedPublishedDish(admin, tenantA.tenantId);
        const ipHash = hash("203.0.113.21");

        await recordDishView(tenantA.tenantId, dishId, hash(`session-${randomUUID()}`), ipHash);
        await recordDishView(tenantA.tenantId, dishId, hash(`session-${randomUUID()}`), ipHash);

        expect(await countEvents(tenantA.tenantId, "dish_view")).toBe(2);
      });

      it("counts the same session again once the dedup day rolls over", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA } = fixture;
        const dishId = await seedPublishedDish(admin, tenantA.tenantId);
        const sessionHash = hash(`session-${randomUUID()}`);
        const ipHash = hash("203.0.113.22");

        expect(await recordDishView(tenantA.tenantId, dishId, sessionHash, ipHash)).toBe(true);

        await admin.query(
          `update dish_engagement_attempts set view_date = view_date - interval '1 day'
         where tenant_id = $1 and dish_id = $2 and event_type = 'dish_view' and session_token_hash = $3`,
          [tenantA.tenantId, dishId, sessionHash],
        );

        expect(await recordDishView(tenantA.tenantId, dishId, sessionHash, ipHash)).toBe(true);
        expect(await countEvents(tenantA.tenantId, "dish_view")).toBe(2);
      });

      it("rate-limits a burst of rapid calls from the same tenant+ip bucket, even across distinct sessions", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA } = fixture;
        const dishId = await seedPublishedDish(admin, tenantA.tenantId);
        const ipHash = hash("203.0.113.23");

        // Fixed threshold is 200/10min (see the migration's header comment) --
        // fire well past it, each with its own fresh session and dish
        // reference, to prove a session-rotating burst still can't create
        // unbounded rows.
        const attempts = 210;
        const results: boolean[] = [];
        for (let i = 0; i < attempts; i += 1) {
          results.push(
            await recordDishView(
              tenantA.tenantId,
              dishId,
              hash(`burst-session-${i}-${randomUUID()}`),
              ipHash,
            ),
          );
        }

        const recordedCount = results.filter(Boolean).length;
        expect(recordedCount).toBe(200);
        expect(await countEvents(tenantA.tenantId, "dish_view")).toBe(200);
      }, 30000);

      it("rejects a dish id that doesn't belong to the given tenant (no cross-tenant attribution)", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA, tenantB } = fixture;
        const dishIdOwnedByTenantB = await seedPublishedDish(admin, tenantB.tenantId);

        const result = await recordDishView(
          tenantA.tenantId,
          dishIdOwnedByTenantB,
          hash("session"),
          hash("203.0.113.24"),
        );

        expect(result).toBe(false);
        expect(await countEvents(tenantA.tenantId, "dish_view")).toBe(0);
        expect(await countEvents(tenantB.tenantId, "dish_view")).toBe(0);
      });

      it("keeps the same raw session token independent across two tenants' own dishes (no cross-tenant leak)", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA, tenantB } = fixture;
        const dishA = await seedPublishedDish(admin, tenantA.tenantId);
        const dishB = await seedPublishedDish(admin, tenantB.tenantId);
        const sharedSessionHash = hash("shared-browser-session");
        const ipHash = hash("203.0.113.25");

        const resultA = await recordDishView(tenantA.tenantId, dishA, sharedSessionHash, ipHash);
        const resultB = await recordDishView(tenantB.tenantId, dishB, sharedSessionHash, ipHash);
        const resultARepeat = await recordDishView(
          tenantA.tenantId,
          dishA,
          sharedSessionHash,
          ipHash,
        );

        expect(resultA).toBe(true);
        expect(resultB).toBe(true);
        expect(resultARepeat).toBe(false);
        expect(await countEvents(tenantA.tenantId, "dish_view")).toBe(1);
        expect(await countEvents(tenantB.tenantId, "dish_view")).toBe(1);
      });
    });

    describe("record_add_to_cart_event", () => {
      it("dedupes repeated calls for the same tenant+dish+session+day into exactly one event", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA } = fixture;
        const dishId = await seedPublishedDish(admin, tenantA.tenantId);
        const sessionHash = hash(`session-${randomUUID()}`);
        const ipHash = hash("203.0.113.30");

        const first = await recordAddToCart(tenantA.tenantId, dishId, sessionHash, ipHash);
        const second = await recordAddToCart(tenantA.tenantId, dishId, sessionHash, ipHash);

        expect(first).toBe(true);
        expect(second).toBe(false);
        expect(await countEvents(tenantA.tenantId, "add_to_cart")).toBe(1);
      });

      it("rate-limits a burst of rapid calls from the same tenant+ip bucket", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA } = fixture;
        const dishId = await seedPublishedDish(admin, tenantA.tenantId);
        const ipHash = hash("203.0.113.31");

        // Fixed threshold is 60/10min (see the migration's header comment).
        const attempts = 70;
        const results: boolean[] = [];
        for (let i = 0; i < attempts; i += 1) {
          results.push(
            await recordAddToCart(
              tenantA.tenantId,
              dishId,
              hash(`burst-session-${i}-${randomUUID()}`),
              ipHash,
            ),
          );
        }

        const recordedCount = results.filter(Boolean).length;
        expect(recordedCount).toBe(60);
        expect(await countEvents(tenantA.tenantId, "add_to_cart")).toBe(60);
      }, 30000);

      it("rejects a dish id that doesn't belong to the given tenant (no cross-tenant attribution)", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA, tenantB } = fixture;
        const dishIdOwnedByTenantB = await seedPublishedDish(admin, tenantB.tenantId);

        const result = await recordAddToCart(
          tenantA.tenantId,
          dishIdOwnedByTenantB,
          hash("session"),
          hash("203.0.113.32"),
        );

        expect(result).toBe(false);
        expect(await countEvents(tenantA.tenantId, "add_to_cart")).toBe(0);
        expect(await countEvents(tenantB.tenantId, "add_to_cart")).toBe(0);
      });
    });

    it("dish_view and add_to_cart dedup buckets are independent for the same tenant+dish+session+day", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;
      const dishId = await seedPublishedDish(admin, tenantA.tenantId);
      const sessionHash = hash(`session-${randomUUID()}`);
      const ipHash = hash("203.0.113.40");

      expect(await recordDishView(tenantA.tenantId, dishId, sessionHash, ipHash)).toBe(true);
      expect(await recordAddToCart(tenantA.tenantId, dishId, sessionHash, ipHash)).toBe(true);
      expect(await countEvents(tenantA.tenantId, "dish_view")).toBe(1);
      expect(await countEvents(tenantA.tenantId, "add_to_cart")).toBe(1);
    });

    // record_dish_views (batched, PR #136 review finding) --
    // supabase/migrations/20260906100000_dish_views_batched_rpc_and_retention.sql
    describe("record_dish_views (batched)", () => {
      async function recordDishViews(
        tenantId: string,
        dishIds: string[],
        sessionTokenHash: string,
        ipHash: string,
      ): Promise<number> {
        const result = await admin.query<{ record_dish_views: number }>(
          `select record_dish_views($1, $2, $3, $4) as record_dish_views`,
          [tenantId, dishIds, sessionTokenHash, ipHash],
        );
        return Number(result.rows[0]!.record_dish_views);
      }

      it("records one dish_view event per dish id for a single batch call", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA } = fixture;
        const dishIds = await Promise.all(
          Array.from({ length: 5 }, () => seedPublishedDish(admin, tenantA.tenantId)),
        );
        const sessionHash = hash(`session-${randomUUID()}`);
        const ipHash = hash("203.0.113.50");

        const recordedCount = await recordDishViews(tenantA.tenantId, dishIds, sessionHash, ipHash);

        expect(recordedCount).toBe(5);
        expect(await countEvents(tenantA.tenantId, "dish_view")).toBe(5);
      });

      it("dedupes a repeated batch call for the same tenant+session+day into zero additional events", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA } = fixture;
        const dishIds = await Promise.all(
          Array.from({ length: 3 }, () => seedPublishedDish(admin, tenantA.tenantId)),
        );
        const sessionHash = hash(`session-${randomUUID()}`);
        const ipHash = hash("203.0.113.51");

        const first = await recordDishViews(tenantA.tenantId, dishIds, sessionHash, ipHash);
        const second = await recordDishViews(tenantA.tenantId, dishIds, sessionHash, ipHash);

        expect(first).toBe(3);
        expect(second).toBe(0);
        expect(await countEvents(tenantA.tenantId, "dish_view")).toBe(3);
      });

      it("silently filters out a dish id that doesn't belong to the given tenant (no cross-tenant attribution)", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA, tenantB } = fixture;
        const ownDishId = await seedPublishedDish(admin, tenantA.tenantId);
        const otherTenantsDishId = await seedPublishedDish(admin, tenantB.tenantId);
        const sessionHash = hash(`session-${randomUUID()}`);
        const ipHash = hash("203.0.113.52");

        const recordedCount = await recordDishViews(
          tenantA.tenantId,
          [ownDishId, otherTenantsDishId],
          sessionHash,
          ipHash,
        );

        expect(recordedCount).toBe(1);
        expect(await countEvents(tenantA.tenantId, "dish_view")).toBe(1);
        expect(await countEvents(tenantB.tenantId, "dish_view")).toBe(0);
      });

      it("respects the shared tenant+ip rate-limit budget across the whole batch, capping at whatever remains", async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA } = fixture;
        const ipHash = hash("203.0.113.53");
        const budgetFillerDishId = await seedPublishedDish(admin, tenantA.tenantId);

        // Pre-fill 195 of the fixed 200/10min budget directly (bypassing the
        // RPC) so this test doesn't need to seed/insert 200+ real dishes to
        // prove the cap -- same (tenant_id, event_type, ip_hash) bucket
        // record_dish_views() itself counts against.
        const fillerAttempts = 195;
        for (let i = 0; i < fillerAttempts; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- simple sequential seeding, not perf-sensitive
          await admin.query(
            `insert into dish_engagement_attempts
               (tenant_id, dish_id, event_type, session_token_hash, ip_hash, view_date)
             values ($1, $2, 'dish_view', $3, $4, (now() at time zone 'utc')::date)`,
            [tenantA.tenantId, budgetFillerDishId, hash(`filler-session-${i}`), ipHash],
          );
        }

        const newDishIds = await Promise.all(
          Array.from({ length: 10 }, () => seedPublishedDish(admin, tenantA.tenantId)),
        );
        const sessionHash = hash(`session-${randomUUID()}`);

        // Only 5 of the remaining budget (200 - 195) should be recorded, even
        // though the batch requests 10 -- the whole batch shares ONE
        // rate-limit check, not one per dish id.
        const recordedCount = await recordDishViews(
          tenantA.tenantId,
          newDishIds,
          sessionHash,
          ipHash,
        );

        expect(recordedCount).toBe(5);
        expect(await countEvents(tenantA.tenantId, "dish_view")).toBe(5);

        const totalAttemptRows = await admin.query<{ c: string }>(
          `select count(*)::int as c from dish_engagement_attempts
           where tenant_id = $1 and event_type = 'dish_view' and ip_hash = $2`,
          [tenantA.tenantId, ipHash],
        );
        expect(Number(totalAttemptRows.rows[0]!.c)).toBe(200);
      });

      it("returns 0 and writes nothing for an unresolvable tenant id", async () => {
        const recordedCount = await recordDishViews(
          randomUUID(),
          [randomUUID()],
          hash("session"),
          hash("203.0.113.54"),
        );
        expect(recordedCount).toBe(0);
      });
    });
  },
);
