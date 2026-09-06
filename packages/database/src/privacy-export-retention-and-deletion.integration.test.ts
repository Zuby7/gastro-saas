// Integration tests for ticket #36 (risk:privacy): privacy_retention_settings,
// export_tenant_data(), data_deletion_requests + process_tenant_data_deletion_request().
// Same DB-probe/skip pattern as the other database integration suites.
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
      `[privacy-export-retention-and-deletion.integration.test] no reachable Postgres at ${DB_URL}.`,
    );
  }
  console.warn(
    `[privacy-export-retention-and-deletion.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

function guestAccessTokenHash(): string {
  return createHash("sha256").update(randomUUID(), "utf8").digest("hex");
}

describe.skipIf(!dbAvailable)(
  "privacy: export, retention settings, deletion requests (ticket #36)",
  () => {
    const admin = new Client({ connectionString: DB_URL });
    let fixture: TwoTenantFixture;

    beforeAll(async () => {
      await admin.connect();
    });

    afterEach(async () => {
      if (fixture) {
        // payments.order_id and orders.tenant_id are both `on delete
        // restrict` (mirrors audit_logs' precedent), so any payment/order
        // this suite created must be explicitly removed, payments first,
        // before the fixture's own cleanup() deletes its tenants. Deleting
        // `orders` cascades to order_items/order_item_selections/
        // order_status_events.
        await admin.query(`delete from payments where tenant_id in ($1, $2)`, [
          fixture.tenantA.tenantId,
          fixture.tenantB.tenantId,
        ]);
        await admin.query(`delete from orders where tenant_id in ($1, $2)`, [
          fixture.tenantA.tenantId,
          fixture.tenantB.tenantId,
        ]);
        await admin.query(`delete from payment_accounts where tenant_id in ($1, $2)`, [
          fixture.tenantA.tenantId,
          fixture.tenantB.tenantId,
        ]);
      }
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

    /** Seeds a minimal order row directly (bypassing checkout), with a controllable `created_at`. */
    async function seedOrder(
      tenantId: string,
      options: { createdAt: Date; customerName?: string; fulfillmentType?: "pickup" | "table" },
    ): Promise<string> {
      const orderId = randomUUID();
      const fulfillmentType = options.fulfillmentType ?? "pickup";
      await admin.query(
        `insert into orders (
         id, tenant_id, guest_access_token_hash, fulfillment_type, customer_name, customer_phone,
         table_identifier, customer_note, total_cents, status, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'received', $10, $10)`,
        [
          orderId,
          tenantId,
          guestAccessTokenHash(),
          fulfillmentType,
          options.customerName ?? "Max Mustermann",
          "+49 30 123456",
          fulfillmentType === "table" ? "Tisch 5" : null,
          "Bitte ohne Zwiebeln",
          1500,
          options.createdAt.toISOString(),
        ],
      );
      return orderId;
    }

    // ---------------------------------------------------------------------
    // privacy_retention_settings
    // ---------------------------------------------------------------------

    it("lets a tenant.settings.write holder (Owner) upsert retention settings for their own tenant", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      await queryAsUser(
        admin,
        tenantA.ownerId,
        `insert into privacy_retention_settings (tenant_id, analytics_events_retention_days, updated_by_user_id)
       values ($1, $2, $3)`,
        [tenantA.tenantId, 90, tenantA.ownerId],
      );

      const row = await admin.query<{ analytics_events_retention_days: number }>(
        `select analytics_events_retention_days from privacy_retention_settings where tenant_id = $1`,
        [tenantA.tenantId],
      );
      expect(row.rows[0]?.analytics_events_retention_days).toBe(90);
    });

    it("denies a Kitchen-role member (no tenant.settings.write) from writing retention settings", async () => {
      const kitchenUserId = randomUUID();
      fixture = await seedTwoTenantFixture(admin, {
        tenantA: {
          additionalMembers: [
            { userId: kitchenUserId, email: "kitchen-privacy@example.test", role: "staff" },
          ],
        },
      });
      const { tenantA } = fixture;
      await assignOnlySystemRole(kitchenUserId, tenantA.tenantId, "kitchen");

      await expect(
        queryAsUser(
          admin,
          kitchenUserId,
          `insert into privacy_retention_settings (tenant_id, analytics_events_retention_days) values ($1, $2)`,
          [tenantA.tenantId, 90],
        ),
      ).rejects.toThrow(/row-level security|permission denied/i);
    });

    it("denies cross-tenant reads/writes of another tenant's retention settings", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA, tenantB } = fixture;

      await admin.query(
        `insert into privacy_retention_settings (tenant_id, analytics_events_retention_days) values ($1, $2)`,
        [tenantA.tenantId, 90],
      );

      await expectCrossTenantDenied({
        client: admin,
        actorUserId: tenantB.ownerId,
        sql: `select analytics_events_retention_days from privacy_retention_settings where tenant_id = $1`,
        params: [tenantA.tenantId],
      });

      await expectCrossTenantDenied({
        client: admin,
        actorUserId: tenantB.ownerId,
        sql: `update privacy_retention_settings set analytics_events_retention_days = 30 where tenant_id = $1 returning tenant_id`,
        params: [tenantA.tenantId],
      });
    });

    // ---------------------------------------------------------------------
    // purge_expired_analytics_events()
    // ---------------------------------------------------------------------

    it("denies a Kitchen-role member (no tenant.settings.write) from calling purge_expired_analytics_events()", async () => {
      const kitchenUserId = randomUUID();
      fixture = await seedTwoTenantFixture(admin, {
        tenantA: {
          additionalMembers: [
            { userId: kitchenUserId, email: "kitchen-purge@example.test", role: "staff" },
          ],
        },
      });
      const { tenantA } = fixture;
      await assignOnlySystemRole(kitchenUserId, tenantA.tenantId, "kitchen");

      await expect(
        queryAsUser(admin, kitchenUserId, `select purge_expired_analytics_events($1)`, [
          tenantA.tenantId,
        ]),
      ).rejects.toThrow(/insufficient_privilege|permission/i);
    });

    it("purges only analytics_events past the configured retention window, keeping newer rows", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      await admin.query(
        `insert into privacy_retention_settings (tenant_id, analytics_events_retention_days) values ($1, $2)`,
        [tenantA.tenantId, 30],
      );

      const keptEventId = randomUUID();
      const purgedEventId = randomUUID();
      const withinRetention = new Date();
      withinRetention.setDate(withinRetention.getDate() - 29); // retention - 1 day
      const pastRetention = new Date();
      pastRetention.setDate(pastRetention.getDate() - 31); // retention + 1 day

      await admin.query(
        `insert into analytics_events (id, tenant_id, event_type, created_at) values ($1, $2, 'page_view', $3)`,
        [keptEventId, tenantA.tenantId, withinRetention.toISOString()],
      );
      await admin.query(
        `insert into analytics_events (id, tenant_id, event_type, created_at) values ($1, $2, 'page_view', $3)`,
        [purgedEventId, tenantA.tenantId, pastRetention.toISOString()],
      );

      const result = await queryAsUser<{ purge_expired_analytics_events: number }>(
        admin,
        tenantA.ownerId,
        `select purge_expired_analytics_events($1)`,
        [tenantA.tenantId],
      );
      expect(result.rows[0]?.purge_expired_analytics_events).toBe(1);

      const remaining = await admin.query<{ id: string }>(
        `select id from analytics_events where tenant_id = $1`,
        [tenantA.tenantId],
      );
      expect(remaining.rows.map((r) => r.id)).toEqual([keptEventId]);
    });

    // Ticket #123: purge_expired_analytics_events() previously wrote no
    // audit_logs entry, unlike process_tenant_data_deletion_request() and
    // the export endpoint. Pins the fix: an audit_logs row must exist
    // recording the actor, tenant, and deleted-row count.
    it("records an audit_logs entry with the actor, tenant, and deleted count", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      await admin.query(
        `insert into privacy_retention_settings (tenant_id, analytics_events_retention_days) values ($1, $2)`,
        [tenantA.tenantId, 30],
      );

      const pastRetention = new Date();
      pastRetention.setDate(pastRetention.getDate() - 31);
      await admin.query(
        `insert into analytics_events (id, tenant_id, event_type, created_at) values ($1, $2, 'page_view', $3)`,
        [randomUUID(), tenantA.tenantId, pastRetention.toISOString()],
      );

      await queryAsUser<{ purge_expired_analytics_events: number }>(
        admin,
        tenantA.ownerId,
        `select purge_expired_analytics_events($1)`,
        [tenantA.tenantId],
      );

      const auditRows = await admin.query<{
        actor_user_id: string;
        action: string;
        target_type: string;
        target_id: string;
        metadata: { deletedCount: number; retentionDays: number };
      }>(
        `select actor_user_id, action, target_type, target_id, metadata
           from audit_logs
          where tenant_id = $1 and action = 'privacy.analytics_events.purged'`,
        [tenantA.tenantId],
      );

      expect(auditRows.rows).toHaveLength(1);
      const auditRow = auditRows.rows[0]!;
      expect(auditRow.actor_user_id).toBe(tenantA.ownerId);
      expect(auditRow.target_type).toBe("tenant");
      expect(auditRow.target_id).toBe(tenantA.tenantId);
      expect(auditRow.metadata.deletedCount).toBe(1);
      expect(auditRow.metadata.retentionDays).toBe(30);
    });

    it("records an audit_logs entry even when nothing was actually expired (deletedCount: 0)", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      await queryAsUser<{ purge_expired_analytics_events: number }>(
        admin,
        tenantA.ownerId,
        `select purge_expired_analytics_events($1)`,
        [tenantA.tenantId],
      );

      const auditRows = await admin.query<{ metadata: { deletedCount: number } }>(
        `select metadata from audit_logs where tenant_id = $1 and action = 'privacy.analytics_events.purged'`,
        [tenantA.tenantId],
      );

      expect(auditRows.rows).toHaveLength(1);
      expect(auditRows.rows[0]!.metadata.deletedCount).toBe(0);
    });

    it("falls back to the 365-day default retention when the tenant has no privacy_retention_settings row", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      const keptEventId = randomUUID();
      const purgedEventId = randomUUID();
      const withinDefault = new Date();
      withinDefault.setDate(withinDefault.getDate() - 364); // default - 1 day
      const pastDefault = new Date();
      pastDefault.setDate(pastDefault.getDate() - 366); // default + 1 day

      await admin.query(
        `insert into analytics_events (id, tenant_id, event_type, created_at) values ($1, $2, 'page_view', $3)`,
        [keptEventId, tenantA.tenantId, withinDefault.toISOString()],
      );
      await admin.query(
        `insert into analytics_events (id, tenant_id, event_type, created_at) values ($1, $2, 'page_view', $3)`,
        [purgedEventId, tenantA.tenantId, pastDefault.toISOString()],
      );

      const settingsRow = await admin.query(
        `select 1 from privacy_retention_settings where tenant_id = $1`,
        [tenantA.tenantId],
      );
      expect(settingsRow.rows).toHaveLength(0);

      const result = await queryAsUser<{ purge_expired_analytics_events: number }>(
        admin,
        tenantA.ownerId,
        `select purge_expired_analytics_events($1)`,
        [tenantA.tenantId],
      );
      expect(result.rows[0]?.purge_expired_analytics_events).toBe(1);

      const remaining = await admin.query<{ id: string }>(
        `select id from analytics_events where tenant_id = $1`,
        [tenantA.tenantId],
      );
      expect(remaining.rows.map((r) => r.id)).toEqual([keptEventId]);
    });

    // ---------------------------------------------------------------------
    // export_tenant_data()
    // ---------------------------------------------------------------------

    it("export_tenant_data() returns only the caller's own tenant data, scoped correctly", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      const orderId = await seedOrder(tenantA.tenantId, { createdAt: new Date() });

      const result = await queryAsUser<{ export_tenant_data: Record<string, unknown> }>(
        admin,
        tenantA.ownerId,
        `select export_tenant_data($1)`,
        [tenantA.tenantId],
      );

      const exportDoc = result.rows[0]?.export_tenant_data as {
        tenantId: string;
        orders: Array<{ id: string; customerName: string }>;
      };
      expect(exportDoc.tenantId).toBe(tenantA.tenantId);
      expect(exportDoc.orders.some((o) => o.id === orderId)).toBe(true);
    });

    it("denies a Kitchen-role member (no tenant.settings.write) from calling export_tenant_data()", async () => {
      const kitchenUserId = randomUUID();
      fixture = await seedTwoTenantFixture(admin, {
        tenantA: {
          additionalMembers: [
            { userId: kitchenUserId, email: "kitchen-export@example.test", role: "staff" },
          ],
        },
      });
      const { tenantA } = fixture;
      await assignOnlySystemRole(kitchenUserId, tenantA.tenantId, "kitchen");

      await expect(
        queryAsUser(admin, kitchenUserId, `select export_tenant_data($1)`, [tenantA.tenantId]),
      ).rejects.toThrow(/insufficient_privilege|permission/i);
    });

    it("denies export_tenant_data() for another tenant's id, even for that caller's own tenant's Owner", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA, tenantB } = fixture;

      await seedOrder(tenantA.tenantId, { createdAt: new Date() });

      await expect(
        queryAsUser(admin, tenantB.ownerId, `select export_tenant_data($1)`, [tenantA.tenantId]),
      ).rejects.toThrow(/insufficient_privilege|permission/i);
    });

    // ---------------------------------------------------------------------
    // tenant.data.delete permission scoping
    // ---------------------------------------------------------------------

    it("grants tenant.data.delete to Owner only, not Manager", async () => {
      const managerUserId = randomUUID();
      fixture = await seedTwoTenantFixture(admin, {
        tenantA: {
          additionalMembers: [
            { userId: managerUserId, email: "manager-delete@example.test", role: "manager" },
          ],
        },
      });
      const { tenantA } = fixture;

      const ownerCan = await queryAsUser<{ has_tenant_permission: boolean }>(
        admin,
        tenantA.ownerId,
        `select has_tenant_permission($1, 'tenant.data.delete')`,
        [tenantA.tenantId],
      );
      expect(ownerCan.rows[0]?.has_tenant_permission).toBe(true);

      const managerCan = await queryAsUser<{ has_tenant_permission: boolean }>(
        admin,
        managerUserId,
        `select has_tenant_permission($1, 'tenant.data.delete')`,
        [tenantA.tenantId],
      );
      expect(managerCan.rows[0]?.has_tenant_permission).toBe(false);
    });

    it("denies a Manager (no tenant.data.delete) from processing a deletion request", async () => {
      const managerUserId = randomUUID();
      fixture = await seedTwoTenantFixture(admin, {
        tenantA: {
          additionalMembers: [
            { userId: managerUserId, email: "manager-delete-2@example.test", role: "manager" },
          ],
        },
      });
      const { tenantA } = fixture;

      await expect(
        queryAsUser(admin, managerUserId, `select process_tenant_data_deletion_request($1, $2)`, [
          tenantA.tenantId,
          "test",
        ]),
      ).rejects.toThrow(/insufficient_privilege|permission/i);

      const requests = await admin.query(
        `select 1 from data_deletion_requests where tenant_id = $1`,
        [tenantA.tenantId],
      );
      expect(requests.rows).toHaveLength(0);
    });

    it("denies processing a deletion request for another tenant's id", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA, tenantB } = fixture;

      await expect(
        queryAsUser(admin, tenantB.ownerId, `select process_tenant_data_deletion_request($1, $2)`, [
          tenantA.tenantId,
          "test",
        ]),
      ).rejects.toThrow(/insufficient_privilege|permission/i);
    });

    // ---------------------------------------------------------------------
    // Core acceptance criterion: deletion request respects the documented
    // legal retention period for order data instead of ignoring it.
    // ---------------------------------------------------------------------

    it("process_tenant_data_deletion_request() retains orders inside the legal retention period untouched, and only anonymizes customer PII on orders past it", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      const recentOrderId = await seedOrder(tenantA.tenantId, {
        createdAt: new Date(),
        customerName: "Recent Customer",
      });
      const oldOrderCutoff = new Date();
      oldOrderCutoff.setFullYear(oldOrderCutoff.getFullYear() - 11);
      const oldOrderId = await seedOrder(tenantA.tenantId, {
        createdAt: oldOrderCutoff,
        customerName: "Old Customer",
        fulfillmentType: "table",
      });

      await admin.query(
        `insert into analytics_events (tenant_id, event_type) values ($1, 'page_view'), ($1, 'add_to_cart')`,
        [tenantA.tenantId],
      );

      const result = await queryAsUser<{ process_tenant_data_deletion_request: string }>(
        admin,
        tenantA.ownerId,
        `select process_tenant_data_deletion_request($1, $2)`,
        [tenantA.tenantId, "GDPR request"],
      );
      const requestId = result.rows[0]?.process_tenant_data_deletion_request;
      expect(requestId).toBeTruthy();

      // The recent order (inside the 10-year legal retention window) must be
      // completely untouched -- this is the required acceptance-criterion test.
      const recentOrder = await admin.query<{
        customer_name: string;
        customer_phone: string | null;
        total_cents: number;
      }>(`select customer_name, customer_phone, total_cents from orders where id = $1`, [
        recentOrderId,
      ]);
      expect(recentOrder.rows[0]).toMatchObject({
        customer_name: "Recent Customer",
        customer_phone: "+49 30 123456",
        total_cents: 1500,
      });

      // The old order (past the retention window) is never deleted -- only its
      // customer-identifying columns are anonymized. total_cents (the actual
      // financial/accounting record the retention duty protects) is untouched.
      const oldOrder = await admin.query<{
        customer_name: string;
        customer_phone: string | null;
        table_identifier: string | null;
        total_cents: number;
      }>(
        `select customer_name, customer_phone, table_identifier, total_cents from orders where id = $1`,
        [oldOrderId],
      );
      expect(oldOrder.rows[0]?.customer_name).not.toBe("Old Customer");
      expect(oldOrder.rows[0]?.customer_phone).toBeNull();
      expect(oldOrder.rows[0]?.table_identifier).not.toBeNull();
      expect(oldOrder.rows[0]?.total_cents).toBe(1500);

      // analytics_events (no legal retention duty) are purged in full.
      const remainingAnalytics = await admin.query(
        `select 1 from analytics_events where tenant_id = $1`,
        [tenantA.tenantId],
      );
      expect(remainingAnalytics.rows).toHaveLength(0);

      // The request row itself records the counts.
      const requestRow = await admin.query<{
        status: string;
        retained_orders_count: number;
        anonymized_orders_count: number;
        analytics_events_purged_count: number;
      }>(
        `select status, retained_orders_count, anonymized_orders_count, analytics_events_purged_count
         from data_deletion_requests where id = $1`,
        [requestId],
      );
      expect(requestRow.rows[0]).toMatchObject({
        status: "completed",
        retained_orders_count: 1,
        anonymized_orders_count: 1,
        analytics_events_purged_count: 2,
      });

      // An audit entry is written for the completed deletion request.
      const auditRow = await admin.query(
        `select 1 from audit_logs where tenant_id = $1 and action = 'privacy.deletion_request.completed'`,
        [tenantA.tenantId],
      );
      expect(auditRow.rows.length).toBeGreaterThan(0);
    });

    it("never touches a payments row, even for an order past the retention period", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      const oldOrderCutoff = new Date();
      oldOrderCutoff.setFullYear(oldOrderCutoff.getFullYear() - 12);
      const oldOrderId = await seedOrder(tenantA.tenantId, { createdAt: oldOrderCutoff });

      // `ensure_payment_matches_order()` requires payments.stripe_account_id
      // to match the tenant's own connected account in payment_accounts.
      const stripeAccountId = `acct_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      await admin.query(
        `insert into payment_accounts (tenant_id, stripe_account_id, status, charges_enabled, payouts_enabled)
         values ($1, $2, 'enabled', true, true)
         on conflict (tenant_id) do update set stripe_account_id = excluded.stripe_account_id, charges_enabled = true`,
        [tenantA.tenantId, stripeAccountId],
      );

      const paymentId = randomUUID();
      await admin.query(
        `insert into payments (
           id, tenant_id, order_id, stripe_checkout_session_id, stripe_account_id,
           amount_cents, currency, status, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [
          paymentId,
          tenantA.tenantId,
          oldOrderId,
          `cs_test_${paymentId.replace(/-/g, "")}`,
          stripeAccountId,
          1500,
          "EUR",
          "paid",
          oldOrderCutoff.toISOString(),
        ],
      );

      await queryAsUser(
        admin,
        tenantA.ownerId,
        `select process_tenant_data_deletion_request($1, $2)`,
        [tenantA.tenantId, null],
      );

      const payment = await admin.query<{
        amount_cents: number;
        status: string;
        currency: string;
      }>(`select amount_cents, status, currency from payments where id = $1`, [paymentId]);
      expect(payment.rows[0]).toMatchObject({
        amount_cents: 1500,
        status: "paid",
        currency: "EUR",
      });
    });

    it("never hard-deletes an order or its immutable line-item snapshots, even past the retention period", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA } = fixture;

      const oldOrderCutoff = new Date();
      oldOrderCutoff.setFullYear(oldOrderCutoff.getFullYear() - 12);
      const oldOrderId = await seedOrder(tenantA.tenantId, { createdAt: oldOrderCutoff });

      const orderItemId = randomUUID();
      await admin.query(
        `insert into order_items (id, tenant_id, order_id, quantity, dish_name_snapshot, unit_price_cents_snapshot)
       values ($1, $2, $3, 1, 'Pizza Margherita', 1500)`,
        [orderItemId, tenantA.tenantId, oldOrderId],
      );

      await queryAsUser(
        admin,
        tenantA.ownerId,
        `select process_tenant_data_deletion_request($1, $2)`,
        [tenantA.tenantId, null],
      );

      const order = await admin.query(`select 1 from orders where id = $1`, [oldOrderId]);
      expect(order.rows).toHaveLength(1);

      const orderItem = await admin.query<{ dish_name_snapshot: string }>(
        `select dish_name_snapshot from order_items where id = $1`,
        [orderItemId],
      );
      expect(orderItem.rows[0]?.dish_name_snapshot).toBe("Pizza Margherita");
    });

    // ---------------------------------------------------------------------
    // data_deletion_requests SELECT RLS through an authenticated session
    // (not just the RLS-bypassing admin client).
    // ---------------------------------------------------------------------

    it("denies a Manager (no tenant.data.delete) from reading data_deletion_requests via RLS", async () => {
      const managerUserId = randomUUID();
      fixture = await seedTwoTenantFixture(admin, {
        tenantA: {
          additionalMembers: [
            { userId: managerUserId, email: "manager-select@example.test", role: "manager" },
          ],
        },
      });
      const { tenantA } = fixture;

      await queryAsUser(
        admin,
        tenantA.ownerId,
        `select process_tenant_data_deletion_request($1, $2)`,
        [tenantA.tenantId, "test"],
      );

      const managerResult = await queryAsUser(
        admin,
        managerUserId,
        `select id from data_deletion_requests where tenant_id = $1`,
        [tenantA.tenantId],
      );
      expect(managerResult.rows).toHaveLength(0);

      // Sanity check: the row genuinely exists (proving the zero rows above
      // is RLS denial, not an empty table).
      const adminCheck = await admin.query(
        `select 1 from data_deletion_requests where tenant_id = $1`,
        [tenantA.tenantId],
      );
      expect(adminCheck.rows.length).toBeGreaterThan(0);
    });

    it("denies tenant B's Owner from reading tenant A's data_deletion_requests via RLS", async () => {
      fixture = await seedTwoTenantFixture(admin);
      const { tenantA, tenantB } = fixture;

      await queryAsUser(
        admin,
        tenantA.ownerId,
        `select process_tenant_data_deletion_request($1, $2)`,
        [tenantA.tenantId, "test"],
      );

      await expectCrossTenantDenied({
        client: admin,
        actorUserId: tenantB.ownerId,
        sql: `select id from data_deletion_requests where tenant_id = $1`,
        params: [tenantA.tenantId],
      });
    });
  },
);
