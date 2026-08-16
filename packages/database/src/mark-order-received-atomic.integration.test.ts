// Integration tests for `mark_order_received_and_paid()` (issue #90): the
// order's received transition and the payment's paid transition must happen
// atomically in one call, not as two separate writes that could leave an
// order "received" with its payment still "pending" if the process crashed
// between them. Same DB-probe/skip pattern as the other database
// integration suites.
import { randomUUID } from "node:crypto";
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
      `[mark-order-received-atomic.integration.test] no reachable Postgres at ${DB_URL}.`,
    );
  }
  console.warn(
    `[mark-order-received-atomic.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

interface Seeded {
  tenantId: string;
  orderId: string;
  paymentId: string;
}

/**
 * Seeds an order in 'awaiting_payment' (with the same initial
 * order_status_events row create_order_from_cart() itself would have
 * written -- see that function's own comment) + a 'pending' payments row for
 * an already-fixture-seeded tenant, bypassing the full checkout flow (out of
 * this test's own scope).
 */
async function seedAwaitingPaymentOrder(
  admin: Client,
  tenantId: string,
  amountCents = 2599,
): Promise<Seeded> {
  const orderId = randomUUID();
  const token = randomUUID();
  const tokenHash = Buffer.from(token).toString("hex").padEnd(64, "0").slice(0, 64);

  await admin.query(
    `insert into orders (id, tenant_id, guest_access_token_hash, fulfillment_type, customer_name, currency, total_cents)
     values ($1, $2, $3, 'pickup', 'Max Mustermann', 'EUR', $4)`,
    [orderId, tenantId, tokenHash, amountCents],
  );

  await admin.query(
    `insert into order_status_events (tenant_id, order_id, from_status, to_status)
     values ($1, $2, null, 'awaiting_payment')`,
    [tenantId, orderId],
  );

  const stripeAccountId = `acct_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await admin.query(
    `insert into payment_accounts (tenant_id, stripe_account_id, status, charges_enabled, payouts_enabled)
     values ($1, $2, 'enabled', true, true)`,
    [tenantId, stripeAccountId],
  );

  const paymentId = randomUUID();
  await admin.query(
    `insert into payments (id, tenant_id, order_id, stripe_checkout_session_id, stripe_payment_intent_id, stripe_account_id, amount_cents, currency, status)
     values ($1, $2, $3, $4, $5, $6, $7, 'EUR', 'pending')`,
    [
      paymentId,
      tenantId,
      orderId,
      `cs_test_${randomUUID().replace(/-/g, "")}`,
      null,
      stripeAccountId,
      amountCents,
    ],
  );

  return { tenantId, orderId, paymentId };
}

describe.skipIf(!dbAvailable)("mark_order_received_and_paid() (issue #90)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    if (fixture) {
      // Deletion order matters: payments/order_status_events -> orders ->
      // payment_accounts, mirroring refunds.integration.test.ts's own
      // precedent for these `on delete restrict` financial tables.
      await admin.query(`delete from payments where tenant_id in ($1, $2)`, [
        fixture.tenantA.tenantId,
        fixture.tenantB.tenantId,
      ]);
      await admin.query(`delete from order_status_events where tenant_id in ($1, $2)`, [
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

  it("atomically transitions the order to received and the payment to paid", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const seed = await seedAwaitingPaymentOrder(admin, fixture.tenantA.tenantId);

    const result = await admin.query<{ mark_order_received_and_paid: boolean }>(
      `select mark_order_received_and_paid($1, $2, $3, $4)`,
      [seed.tenantId, seed.orderId, seed.paymentId, "pi_test_new"],
    );
    expect(result.rows[0]?.mark_order_received_and_paid).toBe(true);

    const order = await admin.query<{ status: string }>(`select status from orders where id = $1`, [
      seed.orderId,
    ]);
    expect(order.rows[0]?.status).toBe("received");

    const payment = await admin.query<{ status: string; stripe_payment_intent_id: string }>(
      `select status, stripe_payment_intent_id from payments where id = $1`,
      [seed.paymentId],
    );
    expect(payment.rows[0]?.status).toBe("paid");
    expect(payment.rows[0]?.stripe_payment_intent_id).toBe("pi_test_new");
  });

  it("returns false (not an error) and leaves the payment untouched when the order's status already moved on", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const seed = await seedAwaitingPaymentOrder(admin, fixture.tenantA.tenantId);

    // Simulate a race: the order was already cancelled by another process
    // before this call.
    await admin.query(
      `insert into order_status_events (tenant_id, order_id, from_status, to_status)
       values ($1, $2, 'awaiting_payment', 'cancelled')`,
      [seed.tenantId, seed.orderId],
    );

    const result = await admin.query<{ mark_order_received_and_paid: boolean }>(
      `select mark_order_received_and_paid($1, $2, $3, $4)`,
      [seed.tenantId, seed.orderId, seed.paymentId, "pi_test_new"],
    );
    expect(result.rows[0]?.mark_order_received_and_paid).toBe(false);

    // Neither the order's status nor the payment's status must have changed
    // -- this is the core atomicity guarantee: a declined transition must
    // never leave the payment paid while the order stays cancelled, or vice
    // versa.
    const order = await admin.query<{ status: string }>(`select status from orders where id = $1`, [
      seed.orderId,
    ]);
    expect(order.rows[0]?.status).toBe("cancelled");

    const payment = await admin.query<{ status: string }>(
      `select status from payments where id = $1`,
      [seed.paymentId],
    );
    expect(payment.rows[0]?.status).toBe("pending");
  });

  // Regression test for the cycle-3 review finding: a check_violation raised
  // by the payments UPDATE itself (not the order_status_events insert) must
  // propagate as a real error, NOT be misreported as the benign "order
  // already moved on" case -- a malformed stripe_payment_intent_id tripping
  // the `~ '^pi_'` check constraint is the concrete trigger used here.
  it("propagates an error (does not return false) when the payments UPDATE itself fails, and leaves the order's received transition rolled back", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const seed = await seedAwaitingPaymentOrder(admin, fixture.tenantA.tenantId);

    await expect(
      admin.query(`select mark_order_received_and_paid($1, $2, $3, $4)`, [
        seed.tenantId,
        seed.orderId,
        seed.paymentId,
        "not-a-valid-payment-intent-id",
      ]),
    ).rejects.toThrow();

    // The whole call rolled back -- the order must NOT be left "received"
    // with its payment still "pending" (the exact bug issue #90 fixes).
    const order = await admin.query<{ status: string }>(`select status from orders where id = $1`, [
      seed.orderId,
    ]);
    expect(order.rows[0]?.status).toBe("awaiting_payment");

    const payment = await admin.query<{ status: string }>(
      `select status from payments where id = $1`,
      [seed.paymentId],
    );
    expect(payment.rows[0]?.status).toBe("pending");
  });

  // Regression test for the cycle-3 review finding: the payments UPDATE
  // must only ever touch the row matching tenant_id/order_id/status='pending'
  // in addition to its id -- defense in depth beyond the bare id match.
  it("does not mark a payment paid if it no longer belongs to the given tenant/order or is no longer pending", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const seed = await seedAwaitingPaymentOrder(admin, fixture.tenantA.tenantId);

    // Payment already finalized by another path in the meantime.
    await admin.query(`update payments set status = 'paid' where id = $1`, [seed.paymentId]);

    const result = await admin.query<{ mark_order_received_and_paid: boolean }>(
      `select mark_order_received_and_paid($1, $2, $3, $4)`,
      [seed.tenantId, seed.orderId, seed.paymentId, "pi_test_new"],
    );
    // The order_status_events insert still succeeds (order_status_events has
    // no idea the payment is already paid), so the RPC still reports true --
    // but the payments UPDATE's `where ... and status = 'pending'` guard
    // means the already-paid row's stripe_payment_intent_id is left
    // untouched rather than silently overwritten.
    expect(result.rows[0]?.mark_order_received_and_paid).toBe(true);

    const payment = await admin.query<{ stripe_payment_intent_id: string | null }>(
      `select stripe_payment_intent_id from payments where id = $1`,
      [seed.paymentId],
    );
    expect(payment.rows[0]?.stripe_payment_intent_id).toBeNull();
  });

  it("is only callable by service_role, never by an authenticated session directly", async () => {
    const result = await admin.query<{ proacl: string }>(
      `select has_function_privilege('authenticated', 'mark_order_received_and_paid(uuid,uuid,uuid,text)', 'execute') as has_priv`,
    );
    expect((result.rows[0] as unknown as { has_priv: boolean }).has_priv).toBe(false);
  });
});
