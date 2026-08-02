import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
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
    throw new Error(`[menu-admin-ui-support.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(
    `[menu-admin-ui-support.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

/**
 * Covers the admin-UI support migration
 * (`supabase/migrations/20260802090000_menu_admin_ui_support.sql`): the
 * `create_initial_draft_menu_version` RPC and the `dish-media` storage
 * bucket's tenant-scoped RLS policies. The DB-only foundation these build on
 * (categories/dishes/variants/etc, RLS, publish checks) is already covered
 * by `menu-management.integration.test.ts`.
 */
describe.skipIf(!dbAvailable)(
  "menu admin UI support (create_initial_draft_menu_version, storage)",
  () => {
    const admin = new Client({ connectionString: DB_URL });
    let fixture: TwoTenantFixture;
    let pool: Pool;

    beforeAll(async () => {
      await admin.connect();
      pool = new Pool({ connectionString: DB_URL, max: 20 });
    });

    afterEach(async () => {
      await fixture?.cleanup();
    });

    afterAll(async () => {
      await admin.end();
      await pool.end();
    });

    /**
     * Runs `sql` as a simulated authenticated session for `userId`, on a
     * connection checked out from `pool` (not `admin`/`queryAsUser`'s single
     * shared client) so multiple calls can genuinely run concurrently on
     * separate physical connections -- required to actually exercise
     * `pg_advisory_xact_lock`'s serialization rather than accidentally
     * serializing for free because everything shares one client/session.
     */
    async function queryAsUserPooled<Row extends Record<string, unknown>>(
      userId: string,
      sql: string,
      params: unknown[] = [],
    ) {
      const client = await pool.connect();
      try {
        await client.query("set role authenticated");
        await client.query("select set_config('request.jwt.claims', $1, false)", [
          JSON.stringify({ sub: userId, role: "authenticated" }),
        ]);
        return await client.query<Row>(sql, params);
      } finally {
        await client.query("select set_config('request.jwt.claims', NULL, false)").catch(() => {});
        await client.query("reset role").catch(() => {});
        client.release();
      }
    }

    it("creates a draft menu version and is idempotent on repeated calls", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      const first = await queryAsUser<{ create_initial_draft_menu_version: string }>(
        admin,
        tenantA.ownerId,
        `select create_initial_draft_menu_version($1)`,
        [tenantA.tenantId],
      );
      const draftId = first.rows[0]?.create_initial_draft_menu_version;
      expect(draftId).toBeTruthy();

      const second = await queryAsUser<{ create_initial_draft_menu_version: string }>(
        admin,
        tenantA.ownerId,
        `select create_initial_draft_menu_version($1)`,
        [tenantA.tenantId],
      );
      expect(second.rows[0]?.create_initial_draft_menu_version).toBe(draftId);

      const stored = await admin.query<{ status: string; tenant_id: string }>(
        `select status, tenant_id from menu_versions where id = $1`,
        [draftId],
      );
      expect(stored.rows[0]).toMatchObject({ status: "draft", tenant_id: tenantA.tenantId });
    });

    it(
      "is concurrency-safe: N parallel calls for the same tenant create exactly one draft, " +
        "and every caller gets back the same id (Opus cycle-3 fix, artifacts/reviews/epic-3-5-batch.json)",
      async () => {
        fixture = await seedTwoTenantFixture(admin);
        const { tenantA } = fixture;
        const concurrency = 15;

        const results = await Promise.all(
          Array.from({ length: concurrency }, () =>
            queryAsUserPooled<{ create_initial_draft_menu_version: string }>(
              tenantA.ownerId,
              `select create_initial_draft_menu_version($1)`,
              [tenantA.tenantId],
            ),
          ),
        );

        const draftIds = results.map((r) => r.rows[0]?.create_initial_draft_menu_version);
        expect(draftIds).toHaveLength(concurrency);
        expect(draftIds.every((id) => typeof id === "string" && id.length > 0)).toBe(true);

        // Every concurrent caller must have been handed back the exact same
        // draft id -- the pre-fix SELECT-then-INSERT race let two parallel
        // callers each create their own "first" draft with distinct ids.
        const uniqueIds = new Set(draftIds);
        expect(uniqueIds.size).toBe(1);

        const draftCount = await admin.query(
          `select count(*)::int as count from menu_versions where tenant_id = $1 and status = 'draft'`,
          [tenantA.tenantId],
        );
        expect(draftCount.rows[0]?.count).toBe(1);

        const versionNumbers = await admin.query<{ version_number: number }>(
          `select version_number from menu_versions where tenant_id = $1`,
          [tenantA.tenantId],
        );
        // Only one row exists at all for this fresh tenant, so there is no
        // duplicate version_number to begin with -- this assertion also
        // guards against a regression that inserts more than one row while
        // somehow still returning the same id to every caller.
        expect(versionNumbers.rows).toHaveLength(1);
      },
    );

    it("rejects calls without menu.write for the target tenant (cross-tenant)", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA, tenantB } = fixture;

      await expect(
        queryAsUser(admin, tenantB.ownerId, `select create_initial_draft_menu_version($1)`, [
          tenantA.tenantId,
        ]),
      ).rejects.toThrow(/Missing permission menu\.write|permission denied|insufficient_privilege/i);
    });

    it("gets-or-creates a fresh draft after the current one is published", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      const firstDraft = await queryAsUser<{ create_initial_draft_menu_version: string }>(
        admin,
        tenantA.ownerId,
        `select create_initial_draft_menu_version($1)`,
        [tenantA.tenantId],
      );
      const draftId = firstDraft.rows[0]!.create_initial_draft_menu_version;

      const categoryId = randomUUID();
      const dishId = randomUUID();
      await admin.query(
        `insert into categories (id, tenant_id, menu_version_id, name, sort_order) values ($1, $2, $3, 'Pizza', 1)`,
        [categoryId, tenantA.tenantId, draftId],
      );
      await admin.query(
        `insert into dishes (id, tenant_id, menu_version_id, category_id, name, price_cents, allergen_reviewed)
       values ($1, $2, $3, $4, 'Margherita', 900, true)`,
        [dishId, tenantA.tenantId, draftId, categoryId],
      );
      await queryAsUser(admin, tenantA.ownerId, `select publish_menu_version($1)`, [draftId]);

      const afterPublish = await queryAsUser<{ create_initial_draft_menu_version: string }>(
        admin,
        tenantA.ownerId,
        `select create_initial_draft_menu_version($1)`,
        [tenantA.tenantId],
      );
      // publish_menu_version() already auto-clones a fresh draft -- this RPC
      // must find and return that one rather than creating yet another.
      expect(afterPublish.rows[0]?.create_initial_draft_menu_version).not.toBe(draftId);

      const draftCount = await admin.query(
        `select count(*)::int as count from menu_versions where tenant_id = $1 and status = 'draft'`,
        [tenantA.tenantId],
      );
      expect(draftCount.rows[0]?.count).toBe(1);
    });

    it("registers the dish-media storage bucket as private with the expected limits", async () => {
      const bucket = await admin.query<{
        public: boolean;
        file_size_limit: string;
        allowed_mime_types: string[];
      }>(
        `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'dish-media'`,
      );

      expect(bucket.rows[0]?.public).toBe(false);
      expect(Number(bucket.rows[0]?.file_size_limit)).toBe(5242880);
      expect(bucket.rows[0]?.allowed_mime_types).toEqual(
        expect.arrayContaining(["image/jpeg", "image/png", "image/webp"]),
      );
    });

    it("lets a tenant member write/read only their own tenant-prefixed storage objects", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA, tenantB } = fixture;
      const ownPath = `${tenantA.tenantId}/${randomUUID()}.jpg`;

      await queryAsUser(
        admin,
        tenantA.ownerId,
        `insert into storage.objects (bucket_id, name, owner) values ('dish-media', $1, $2)`,
        [ownPath, tenantA.ownerId],
      );

      const ownRead = await queryAsUser<{ name: string }>(
        admin,
        tenantA.ownerId,
        `select name from storage.objects where bucket_id = 'dish-media' and name = $1`,
        [ownPath],
      );
      expect(ownRead.rows).toHaveLength(1);

      await expectCrossTenantDenied({
        client: admin,
        actorUserId: tenantB.ownerId,
        sql: `select name from storage.objects where bucket_id = 'dish-media' and name = $1`,
        params: [ownPath],
      });

      const otherTenantPath = `${tenantB.tenantId}/${randomUUID()}.jpg`;
      await expectCrossTenantDenied({
        client: admin,
        actorUserId: tenantA.ownerId,
        sql: `insert into storage.objects (bucket_id, name, owner) values ('dish-media', $1, $2)`,
        params: [otherTenantPath, tenantA.ownerId],
      });

      // Note: the local Supabase storage extension blocks direct SQL DELETEs
      // against storage.objects ("Use the Storage API instead") even for a
      // superuser connection -- this test's leftover row is harmless ephemeral
      // local-DB test data (random path, no collision risk) and isn't cleaned
      // up here for that reason.
    });
  },
);
