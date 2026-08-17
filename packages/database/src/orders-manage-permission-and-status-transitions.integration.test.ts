// Integration tests for the `orders.manage` permission and the kitchen
// workflow status-transition RPC introduced by ticket #28 (Epic 8:
// Küchen-Workflow / Statuswechsel).
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
      `[orders-manage-permission-and-status-transitions.integration.test] CI or SUPABASE_DB_URL is ` +
        `set, but no reachable Postgres was found at ${DB_URL}. Refusing to silently skip the ` +
        "orders.manage tenant-isolation/permission-boundary suite in CI -- check the " +
        "migration-check workflow's `supabase start` step.",
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[orders-manage-permission-and-status-transitions.integration.test] Skipping: no reachable ` +
      `Postgres at ${DB_URL}. Run \`pnpm --filter @gastro-saas/database db:start\` (requires a ` +
      "working local Docker setup) to exercise this test locally, or rely on the migration-check " +
      "CI workflow.",
  );
}

// The state machine's linear happy path (see
// packages/domain/src/orders/state-machine.ts) -- used below to seed a
// consistent, validate_order_status_event()-satisfying order_status_events
// history up to a given target status, since transition_order_status()
// (this ticket's RPC) relies on that trigger's own bookkeeping (an order's
// very first event must have `from_status = null`, and every later event's
// `from_status` must match the order's actual current status).
const LINEAR_STATUS_PATH = [
  "awaiting_payment",
  "received",
  "accepted",
  "preparing",
  "ready",
  "completed",
];

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

  // `cancelled` is reachable straight from `awaiting_payment` -- no need to
  // walk the full linear path for it. Every other status is seeded by
  // walking LINEAR_STATUS_PATH up to and including the target.
  const path =
    status === "cancelled"
      ? ["awaiting_payment", "cancelled"]
      : LINEAR_STATUS_PATH.slice(0, LINEAR_STATUS_PATH.indexOf(status) + 1);

  for (let i = 0; i < path.length; i += 1) {
    const fromStatus = i === 0 ? null : path[i - 1];
    await admin.query(
      `insert into order_status_events (tenant_id, order_id, from_status, to_status)
       values ($1, $2, $3, $4)`,
      [tenantId, orderId, fromStatus, path[i]],
    );
  }

  return orderId;
}

describe.skipIf(!dbAvailable)(
  "orders.manage permission and kitchen-workflow status transitions (ticket #28, risk:tenant-isolation)",
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
        await admin.query(`delete from order_status_events where tenant_id in ($1, $2)`, [
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

    /** Reassigns `userId`'s standard-role membership in `tenantId` to `roleKey` ('kitchen'/'marketing'/...). */
    async function reassignToRole(
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

    it("Owner/Manager/Service/Kitchen system roles hold orders.manage by default; Marketing does not", async () => {
      const seed = await seedFixtureWithStaff();
      fixture = seed.fixture;

      const grants = await admin.query<{ key: string }>(
        `select r.key
         from roles r
         join role_permissions rp on rp.role_id = r.id
        where r.tenant_id = $1
          and rp.permission_key = 'orders.manage'
        order by r.key`,
        [fixture.tenantA.tenantId],
      );

      expect(grants.rows.map((r) => r.key)).toEqual(["kitchen", "manager", "owner", "service"]);
    });

    describe("transition_order_status: Kitchen permission boundary (core ticket #28 requirement)", () => {
      it("a Kitchen member can change an order's status through the preparation lifecycle", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(fixture.tenantA.tenantId, seed.staffAId, "kitchen");
        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "received");

        const accepted = await queryAsUser(
          admin,
          seed.staffAId,
          `select transition_order_status($1, $2, 'accepted') ->> 'status' as status`,
          [fixture.tenantA.tenantId, orderId],
        );
        expect(accepted.rows[0]!.status).toBe("accepted");

        const preparing = await queryAsUser(
          admin,
          seed.staffAId,
          `select transition_order_status($1, $2, 'preparing') ->> 'status' as status`,
          [fixture.tenantA.tenantId, orderId],
        );
        expect(preparing.rows[0]!.status).toBe("preparing");

        const ready = await queryAsUser(
          admin,
          seed.staffAId,
          `select transition_order_status($1, $2, 'ready') ->> 'status' as status`,
          [fixture.tenantA.tenantId, orderId],
        );
        expect(ready.rows[0]!.status).toBe("ready");

        const finalOrder = await admin.query<{ status: string }>(
          `select status from orders where id = $1`,
          [orderId],
        );
        expect(finalOrder.rows[0]!.status).toBe("ready");

        const events = await admin.query<{
          from_status: string | null;
          to_status: string;
          actor_user_id: string;
        }>(
          `select from_status, to_status, actor_user_id from order_status_events
            where order_id = $1 order by created_at`,
          [orderId],
        );
        expect(events.rows.map((r) => r.to_status)).toEqual([
          "awaiting_payment",
          "received",
          "accepted",
          "preparing",
          "ready",
        ]);
        // The first two events (order creation + the seed helper's
        // "received" step) have no actor -- only transition_order_status()
        // itself populates actor_user_id, starting with the third event.
        expect(events.rows[2]!.actor_user_id).toBe(seed.staffAId);
      });

      it("that same Kitchen member is still denied payments.read-gated data (revenue/refunds) -- the explicit ticket #28 denial test", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(fixture.tenantA.tenantId, seed.staffAId, "kitchen");
        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "received");

        const stripeAccountId = `acct_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        await admin.query(
          `insert into payment_accounts (tenant_id, stripe_account_id, status, charges_enabled, payouts_enabled)
           values ($1, $2, 'enabled', true, true)`,
          [fixture.tenantA.tenantId, stripeAccountId],
        );
        await admin.query(
          `insert into payments (tenant_id, order_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_account_id, amount_cents, currency, status)
           values ($1, $2, $3, $4, $5, 1500, 'EUR', 'paid')`,
          [
            fixture.tenantA.tenantId,
            orderId,
            `cs_test_${randomUUID().replace(/-/g, "")}`,
            `pi_test_${randomUUID().replace(/-/g, "")}`,
            stripeAccountId,
          ],
        );

        // Kitchen can still manage the order status...
        const transitioned = await queryAsUser(
          admin,
          seed.staffAId,
          `select transition_order_status($1, $2, 'accepted') ->> 'status' as status`,
          [fixture.tenantA.tenantId, orderId],
        );
        expect(transitioned.rows[0]!.status).toBe("accepted");

        // ...but must never see revenue/payment data (payments.read-gated,
        // ticket #26's existing policy -- verified here, not rebuilt).
        const paymentsRead = await queryAsUser(
          admin,
          seed.staffAId,
          `select id from payments where tenant_id = $1 and order_id = $2`,
          [fixture.tenantA.tenantId, orderId],
        );
        expect(paymentsRead.rows).toHaveLength(0);

        // Explicit require_tenant_permission-gated RPC call also denies.
        await expect(
          queryAsUser(
            admin,
            seed.staffAId,
            `select require_tenant_permission($1, 'payments.read')`,
            [fixture.tenantA.tenantId],
          ),
        ).rejects.toThrow(/insufficient_privilege|Missing permission/i);
      });

      it("denies a member without orders.manage (Marketing) from transitioning an order's status", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(fixture.tenantA.tenantId, seed.staffAId, "marketing");
        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "received");

        await expect(
          queryAsUser(admin, seed.staffAId, `select transition_order_status($1, $2, 'accepted')`, [
            fixture.tenantA.tenantId,
            orderId,
          ]),
        ).rejects.toThrow(/insufficient_privilege|Missing permission/i);

        const unchanged = await admin.query<{ status: string }>(
          `select status from orders where id = $1`,
          [orderId],
        );
        expect(unchanged.rows[0]!.status).toBe("received");
      });
    });

    // Epic 8 Opus batch review, finding 4: cancellation is gated on
    // orders.manage AND orders.cancel -- previously orders.manage alone was
    // sufficient, even though orders.cancel exists specifically to scope
    // this action separately.
    describe("transition_order_status: cancellation additionally requires orders.cancel (finding 4)", () => {
      it("denies '-> cancelled' for a member with orders.manage but not orders.cancel, while other transitions still work", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(fixture.tenantA.tenantId, seed.staffAId, "kitchen");
        // Kitchen holds both orders.manage and orders.cancel by default --
        // strip orders.cancel specifically so only orders.manage remains.
        await admin.query(
          `delete from role_permissions
            where permission_key = 'orders.cancel'
              and role_id in (select id from roles where tenant_id = $1 and key = 'kitchen')`,
          [fixture.tenantA.tenantId],
        );

        const hasManage = await queryAsUser<{ has_tenant_permission: boolean }>(
          admin,
          seed.staffAId,
          `select has_tenant_permission($1, 'orders.manage') as has_tenant_permission`,
          [fixture.tenantA.tenantId],
        );
        expect(hasManage.rows[0]?.has_tenant_permission).toBe(true);
        const hasCancel = await queryAsUser<{ has_tenant_permission: boolean }>(
          admin,
          seed.staffAId,
          `select has_tenant_permission($1, 'orders.cancel') as has_tenant_permission`,
          [fixture.tenantA.tenantId],
        );
        expect(hasCancel.rows[0]?.has_tenant_permission).toBe(false);

        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "received");

        await expect(
          queryAsUser(admin, seed.staffAId, `select transition_order_status($1, $2, 'cancelled')`, [
            fixture.tenantA.tenantId,
            orderId,
          ]),
        ).rejects.toThrow(/insufficient_privilege|Missing permission/i);

        const stillReceived = await admin.query<{ status: string }>(
          `select status from orders where id = $1`,
          [orderId],
        );
        expect(stillReceived.rows[0]!.status).toBe("received");

        // Other transitions (gated on orders.manage alone) still succeed for
        // this same member.
        const accepted = await queryAsUser(
          admin,
          seed.staffAId,
          `select transition_order_status($1, $2, 'accepted') ->> 'status' as status`,
          [fixture.tenantA.tenantId, orderId],
        );
        expect(accepted.rows[0]!.status).toBe("accepted");
      });

      it("allows '-> cancelled' for a member holding both orders.manage and orders.cancel", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(fixture.tenantA.tenantId, seed.staffAId, "kitchen");
        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "received");

        const cancelled = await queryAsUser(
          admin,
          seed.staffAId,
          `select transition_order_status($1, $2, 'cancelled') ->> 'status' as status`,
          [fixture.tenantA.tenantId, orderId],
        );
        expect(cancelled.rows[0]!.status).toBe("cancelled");
      });
    });

    describe("transition_order_status: invalid transitions rejected (state machine enforcement)", () => {
      it("rejects skipping straight from 'received' to 'ready'", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(fixture.tenantA.tenantId, seed.staffAId, "kitchen");
        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "received");

        await expect(
          queryAsUser(admin, seed.staffAId, `select transition_order_status($1, $2, 'ready')`, [
            fixture.tenantA.tenantId,
            orderId,
          ]),
        ).rejects.toThrow(/Invalid order status transition/i);

        const unchanged = await admin.query<{ status: string }>(
          `select status from orders where id = $1`,
          [orderId],
        );
        expect(unchanged.rows[0]!.status).toBe("received");
      });

      it("rejects transitioning an already-completed order", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(fixture.tenantA.tenantId, seed.staffAId, "kitchen");
        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "completed");

        await expect(
          queryAsUser(admin, seed.staffAId, `select transition_order_status($1, $2, 'preparing')`, [
            fixture.tenantA.tenantId,
            orderId,
          ]),
        ).rejects.toThrow(/Invalid order status transition/i);
      });

      it("rejects transitioning a cancelled order", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(fixture.tenantA.tenantId, seed.staffAId, "kitchen");
        const orderId = await seedOrder(admin, fixture.tenantA.tenantId, "cancelled");

        await expect(
          queryAsUser(admin, seed.staffAId, `select transition_order_status($1, $2, 'accepted')`, [
            fixture.tenantA.tenantId,
            orderId,
          ]),
        ).rejects.toThrow(/Invalid order status transition/i);
      });
    });

    describe("transition_order_status: cross-tenant isolation", () => {
      it("never lets a Kitchen member of tenant A transition tenant B's order", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(fixture.tenantA.tenantId, seed.staffAId, "kitchen");
        await reassignToRole(fixture.tenantB.tenantId, seed.staffBId, "kitchen");
        const orderIdB = await seedOrder(admin, fixture.tenantB.tenantId, "received", {
          customerName: "Tenant B Kunde",
        });

        // Tenant A's own tenant_id, tenant B's order id: the function's own
        // `tenant_id = p_tenant_id` filter finds no matching order.
        await expect(
          queryAsUser(admin, seed.staffAId, `select transition_order_status($1, $2, 'accepted')`, [
            fixture.tenantA.tenantId,
            orderIdB,
          ]),
        ).rejects.toThrow(/Order not found/i);

        const unchanged = await admin.query<{ status: string }>(
          `select status from orders where id = $1`,
          [orderIdB],
        );
        expect(unchanged.rows[0]!.status).toBe("received");

        // Sanity check: tenantB's own Kitchen member (same permission, right
        // tenant) can transition it.
        const asTenantBKitchen = await queryAsUser(
          admin,
          seed.staffBId,
          `select transition_order_status($1, $2, 'accepted') ->> 'status' as status`,
          [fixture.tenantB.tenantId, orderIdB],
        );
        expect(asTenantBKitchen.rows[0]!.status).toBe("accepted");
      });

      it("never leaks tenant B's order to tenant A's Kitchen member via a plain SELECT either (orders_select_orders_read RLS, ticket #27)", async () => {
        const seed = await seedFixtureWithStaff();
        fixture = seed.fixture;
        await reassignToRole(fixture.tenantA.tenantId, seed.staffAId, "kitchen");
        const orderIdB = await seedOrder(admin, fixture.tenantB.tenantId, "received");

        await expectCrossTenantDenied({
          client: admin,
          actorUserId: seed.staffAId,
          sql: `select id from orders where id = $1`,
          params: [orderIdB],
        });
      });
    });
  },
);
