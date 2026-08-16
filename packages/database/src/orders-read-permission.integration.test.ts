// Integration tests for the `orders.read` permission and the staff order
// dashboard read path introduced by ticket #27 (risk:tenant-isolation).
//
// Same DB-probe/skip pattern as the other database integration suites: these
// tests exercise real RLS policies/functions against local Supabase Postgres
// when available, and fail instead of silently skipping in CI.
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
      `[orders-read-permission.integration.test] CI or SUPABASE_DB_URL is set, but no reachable ` +
        `Postgres was found at ${DB_URL}. Refusing to silently skip the orders.read ` +
        "tenant-isolation suite in CI -- check the migration-check workflow's `supabase start` step.",
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[orders-read-permission.integration.test] Skipping: no reachable Postgres at ${DB_URL}. ` +
      "Run `pnpm --filter @gastro-saas/database db:start` (requires a working local Docker setup) " +
      "to exercise this test locally, or rely on the migration-check CI workflow.",
  );
}

async function seedOrder(
  admin: Client,
  tenantId: string,
  status: string,
  overrides: { customerName?: string } = {},
): Promise<string> {
  const orderId = randomUUID();
  const token = randomUUID();
  const tokenHash = Buffer.from(token).toString("hex").padEnd(64, "0").slice(0, 64);

  await admin.query(
    `insert into orders (id, tenant_id, guest_access_token_hash, fulfillment_type, customer_name, currency, total_cents, status)
     values ($1, $2, $3, 'pickup', $4, 'EUR', 1500, $5)`,
    [orderId, tenantId, tokenHash, overrides.customerName ?? "Max Mustermann", status],
  );

  return orderId;
}

async function seedPaidPayment(
  admin: Client,
  tenantId: string,
  orderId: string,
  amountCents = 1500,
) {
  const stripeAccountId = `acct_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await admin.query(
    `insert into payment_accounts (tenant_id, stripe_account_id, status, charges_enabled, payouts_enabled)
     values ($1, $2, 'enabled', true, true)
     on conflict (tenant_id) do update set stripe_account_id = excluded.stripe_account_id, charges_enabled = true`,
    [tenantId, stripeAccountId],
  );

  const paymentId = randomUUID();
  await admin.query(
    `insert into payments (id, tenant_id, order_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_account_id, amount_cents, currency, status)
     values ($1, $2, $3, $4, $5, $6, $7, 'EUR', 'paid')`,
    [
      paymentId,
      tenantId,
      orderId,
      `cs_test_${randomUUID().replace(/-/g, "")}`,
      `pi_test_${randomUUID().replace(/-/g, "")}`,
      stripeAccountId,
      amountCents,
    ],
  );

  return paymentId;
}

describe.skipIf(!dbAvailable)(
  "orders.read permission and staff dashboard (ticket #27, risk:tenant-isolation)",
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
        await admin.query(`delete from refunds where tenant_id in ($1, $2)`, [
          fixture.tenantA.tenantId,
          fixture.tenantB.tenantId,
        ]);
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

    /** Reassigns `userId`'s membership in `tenantId` from Service to Marketing (which does NOT hold orders.read). */
    async function reassignToMarketing(tenantId: string, userId: string): Promise<void> {
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
         join roles r on r.tenant_id = tm.tenant_id and r.key = 'marketing'
        where tm.tenant_id = $1
          and tm.user_id = $2`,
        [tenantId, userId],
      );
    }

    it("Owner/Manager/Service/Kitchen system roles hold orders.read by default; Marketing does not", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;

      const grants = await admin.query<{ key: string }>(
        `select r.key
         from roles r
         join role_permissions rp on rp.role_id = r.id
        where r.tenant_id = $1
          and rp.permission_key = 'orders.read'
        order by r.key`,
        [fixture.tenantA.tenantId],
      );

      expect(grants.rows.map((r) => r.key)).toEqual(["kitchen", "manager", "owner", "service"]);
    });

    it("a staff (Service) member holding orders.read can see the tenant's orders through orders_select_orders_read", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "received");

      const result = await queryAsUser(
        admin,
        seed.staffAId,
        `select id, status from orders where id = $1`,
        [orderId],
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.status).toBe("received");
    });

    it("denies a member without orders.read (Marketing) from seeing the tenant's orders (permission-denied case)", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await reassignToMarketing(fixture.tenantA.tenantId, seed.staffAId);
      const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "received");

      const result = await queryAsUser(
        admin,
        seed.staffAId,
        `select id from orders where id = $1`,
        [orderId],
      );

      expect(result.rows).toHaveLength(0);
    });

    it("never leaks another tenant's orders to a staff member who holds orders.read only in their own tenant (cross-tenant isolation)", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      const orderIdB = await seedOrder(admin, fixture.tenantB.tenantId, "received", {
        customerName: "Tenant B Kunde",
      });

      // tenantA's staff member holds orders.read, but only in tenant A.
      await expectCrossTenantDenied({
        client: admin,
        actorUserId: seed.staffAId,
        sql: `select id from orders where id = $1`,
        params: [orderIdB],
      });

      // Sanity check: tenantB's own staff member (same permission, right tenant) can see it.
      const asTenantBStaff = await queryAsUser(
        admin,
        seed.staffBId,
        `select id from orders where id = $1`,
        [orderIdB],
      );
      expect(asTenantBStaff.rows).toHaveLength(1);
    });

    it("a full list query for the dashboard board never returns another tenant's orders, even with matching statuses", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;
      await seedOrder(admin, fixture.tenantA.tenantId, "received", {
        customerName: "Tenant A Kunde 1",
      });
      await seedOrder(admin, fixture.tenantA.tenantId, "preparing", {
        customerName: "Tenant A Kunde 2",
      });
      await seedOrder(admin, fixture.tenantB.tenantId, "received", {
        customerName: "Tenant B Kunde 1",
      });

      const result = await queryAsUser(
        admin,
        seed.staffAId,
        `select customer_name from orders where tenant_id = $1 order by created_at`,
        [fixture.tenantA.tenantId],
      );

      expect(result.rows.map((r) => r.customer_name)).toEqual([
        "Tenant A Kunde 1",
        "Tenant A Kunde 2",
      ]);
    });

    describe("get_tenant_order_payment_statuses (narrow orders.read-gated payment-status projection)", () => {
      it("returns 'unpaid' for an order with no payments row", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "received");

        const result = await queryAsUser(
          admin,
          seed.staffAId,
          `select order_id, payment_status from get_tenant_order_payment_statuses($1, $2)`,
          [fixture.tenantA.tenantId, [orderId]],
        );

        expect(result.rows).toEqual([{ order_id: orderId, payment_status: "unpaid" }]);
      });

      it("returns 'paid' for an order with a paid, unrefunded payment", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "preparing");
        await seedPaidPayment(admin, fixture.tenantA.tenantId, orderId, 1500);

        const result = await queryAsUser(
          admin,
          seed.staffAId,
          `select payment_status from get_tenant_order_payment_statuses($1, $2)`,
          [fixture.tenantA.tenantId, [orderId]],
        );

        expect(result.rows[0]!.payment_status).toBe("paid");
      });

      it("returns 'refunded' once the paid amount is fully refunded, and 'partially_refunded' for a partial refund", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "cancelled");
        const paymentId = await seedPaidPayment(admin, fixture.tenantA.tenantId, orderId, 1500);

        await admin.query(
          `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id, status)
         values ($1, $2, $3, 500, 'EUR', 'Teilerstattung', $4, 'succeeded')`,
          [fixture.tenantA.tenantId, paymentId, orderId, seed.staffAId],
        );

        const partial = await queryAsUser(
          admin,
          seed.staffAId,
          `select payment_status from get_tenant_order_payment_statuses($1, $2)`,
          [fixture.tenantA.tenantId, [orderId]],
        );
        expect(partial.rows[0]!.payment_status).toBe("partially_refunded");

        await admin.query(
          `insert into refunds (tenant_id, payment_id, order_id, amount_cents, currency, reason, actor_user_id, status)
         values ($1, $2, $3, 1000, 'EUR', 'Restbetrag', $4, 'succeeded')`,
          [fixture.tenantA.tenantId, paymentId, orderId, seed.staffAId],
        );

        const full = await queryAsUser(
          admin,
          seed.staffAId,
          `select payment_status from get_tenant_order_payment_statuses($1, $2)`,
          [fixture.tenantA.tenantId, [orderId]],
        );
        expect(full.rows[0]!.payment_status).toBe("refunded");
      });

      it("is gated on orders.read: denies a caller without orders.read (permission-denied case)", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToMarketing(fixture.tenantA.tenantId, seed.staffAId);
        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "received");

        await expect(
          queryAsUser(
            admin,
            seed.staffAId,
            `select payment_status from get_tenant_order_payment_statuses($1, $2)`,
            [fixture.tenantA.tenantId, [orderId]],
          ),
        ).rejects.toThrow(/insufficient_privilege|Missing permission/i);
      });

      it("never returns another tenant's payment status, even when the caller passes the other tenant's order id alongside their own tenant_id", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        const orderIdB = await seedOrder(admin, fixture.tenantB.tenantId, "received");
        await seedPaidPayment(admin, fixture.tenantB.tenantId, orderIdB, 1500);

        // tenantA's staff holds orders.read only in tenant A -- passing tenant A's
        // own tenant_id alongside tenant B's order id must return nothing (the
        // function's own `o.tenant_id = p_tenant_id` filter, independent of RLS).
        const result = await queryAsUser(
          admin,
          seed.staffAId,
          `select order_id, payment_status from get_tenant_order_payment_statuses($1, $2)`,
          [fixture.tenantA.tenantId, [orderIdB]],
        );

        expect(result.rows).toHaveLength(0);
      });
    });
  },
);
