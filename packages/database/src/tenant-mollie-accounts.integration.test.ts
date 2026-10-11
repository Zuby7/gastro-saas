// Integration tests for Mollie Connect storage and the provider-aware payments
// table (issue #195, ADR-0004). Same DB-probe/skip pattern as the other
// database integration suites.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { queryAsUser, seedTwoTenantFixture, type TwoTenantFixture } from "@gastro-saas/testing";

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
      `[tenant-mollie-accounts.integration.test] no reachable Postgres at ${DB_URL}.`,
    );
  }
  console.warn(
    `[tenant-mollie-accounts.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

async function insertMollieAccount(
  admin: Client,
  tenantId: string,
  profileId: string,
  options: { paypalEnabled?: boolean; status?: string } = {},
) {
  await admin.query(
    `insert into tenant_mollie_accounts
       (tenant_id, mollie_profile_id, access_token_ciphertext, access_token_iv,
        refresh_token_ciphertext, refresh_token_iv, token_expires_at, status, paypal_enabled)
     values ($1, $2, 'ct-access', 'iv-access', 'ct-refresh', 'iv-refresh', now() + interval '1 hour', $3, $4)`,
    [tenantId, profileId, options.status ?? "connected", options.paypalEnabled ?? true],
  );
}

async function seedOrder(admin: Client, tenantId: string, amountCents = 1500): Promise<string> {
  const orderId = randomUUID();
  const tokenHash = Buffer.from(randomUUID()).toString("hex").padEnd(64, "0").slice(0, 64);
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
  return orderId;
}

describe.skipIf(!dbAvailable)("tenant_mollie_accounts + mollie payments (issue #195)", () => {
  const admin = new Client({ connectionString: DB_URL });
  let fixture: TwoTenantFixture | undefined;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    if (fixture) {
      const ids = [fixture.tenantA.tenantId, fixture.tenantB.tenantId];
      await admin.query(`delete from payments where tenant_id = any($1)`, [ids]);
      await admin.query(`delete from order_status_events where tenant_id = any($1)`, [ids]);
      await admin.query(`delete from orders where tenant_id = any($1)`, [ids]);
      await admin.query(`delete from tenant_mollie_accounts where tenant_id = any($1)`, [ids]);
    }
    await fixture?.cleanup();
    fixture = undefined;
  });

  afterAll(async () => {
    await admin.end();
  });

  it("gives authenticated members no direct access at all to the token table (cross-tenant and own tenant)", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    await insertMollieAccount(admin, tenantA.tenantId, "pfl_a");
    await insertMollieAccount(admin, tenantB.tenantId, "pfl_b");

    // The owner cannot read even their OWN tenant's row (token columns).
    await expect(
      queryAsUser(admin, tenantA.ownerId, `select * from tenant_mollie_accounts`),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `select access_token_ciphertext from tenant_mollie_accounts where tenant_id = $1`,
        [tenantB.tenantId],
      ),
    ).rejects.toThrow(/permission denied/i);

    // Writes are denied too: no insert / update / delete for authenticated.
    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `update tenant_mollie_accounts set paypal_enabled = true where tenant_id = $1`,
        [tenantA.tenantId],
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `delete from tenant_mollie_accounts where tenant_id = $1`,
        [tenantB.tenantId],
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      queryAsUser(
        admin,
        tenantA.ownerId,
        `insert into tenant_mollie_accounts
           (tenant_id, access_token_ciphertext, access_token_iv, refresh_token_ciphertext, refresh_token_iv, token_expires_at)
         values ($1, 'x', 'x', 'x', 'x', now())`,
        [tenantA.tenantId],
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("exposes only non-secret status through get_mollie_connection_status, scoped to the caller's own tenant", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    await insertMollieAccount(admin, tenantA.tenantId, "pfl_a", { paypalEnabled: true });
    await insertMollieAccount(admin, tenantB.tenantId, "pfl_b", { paypalEnabled: false });

    const own = await queryAsUser<Record<string, unknown>>(
      admin,
      tenantA.ownerId,
      `select * from get_mollie_connection_status($1)`,
      [tenantA.tenantId],
    );
    expect(own.rows).toHaveLength(1);
    expect(own.rows[0]).toMatchObject({
      status: "connected",
      paypal_enabled: true,
      mollie_profile_id: "pfl_a",
    });
    expect(Object.keys(own.rows[0] ?? {}).join(",")).not.toMatch(/token|ciphertext|iv/);

    // Cross-tenant: tenant A's owner asking for tenant B is refused.
    await expect(
      queryAsUser(admin, tenantA.ownerId, `select * from get_mollie_connection_status($1)`, [
        tenantB.tenantId,
      ]),
    ).rejects.toThrow(/Missing permission payments\.read/);
    await expect(
      queryAsUser(admin, tenantB.ownerId, `select * from get_mollie_connection_status($1)`, [
        tenantA.tenantId,
      ]),
    ).rejects.toThrow(/Missing permission payments\.read/);
  });

  it("denies the status RPC to members without payments.read", async () => {
    const kitchenUserId = randomUUID();
    fixture = await seedTwoTenantFixture(admin, {
      tenantA: {
        additionalMembers: [
          { userId: kitchenUserId, email: "kitchen-mollie@example.test", role: "staff" },
        ],
      },
    });
    const { tenantA } = fixture;
    await insertMollieAccount(admin, tenantA.tenantId, "pfl_a");

    // Same technique as payment-accounts.integration.test.ts: leave the member
    // with only the Kitchen system role (no payments.read).
    const membership = await admin.query<{ id: string }>(
      `select id from tenant_memberships where tenant_id = $1 and user_id = $2`,
      [tenantA.tenantId, kitchenUserId],
    );
    const role = await admin.query<{ id: string }>(
      `select id from roles where tenant_id = $1 and key = 'kitchen'`,
      [tenantA.tenantId],
    );
    await admin.query(
      `delete from membership_roles
        where membership_id = $1
          and role_id in (select id from roles where tenant_id = $2 and is_system = true)`,
      [membership.rows[0]!.id, tenantA.tenantId],
    );
    await admin.query(`insert into membership_roles (membership_id, role_id) values ($1, $2)`, [
      membership.rows[0]!.id,
      role.rows[0]!.id,
    ]);

    await expect(
      queryAsUser(admin, kitchenUserId, `select * from get_mollie_connection_status($1)`, [
        tenantA.tenantId,
      ]),
    ).rejects.toThrow(/Missing permission payments\.read/);
  });

  it("accepts a mollie payment for a connected tenant with PayPal enabled and keeps Stripe columns null", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    await insertMollieAccount(admin, tenantA.tenantId, "pfl_a");
    const orderId = await seedOrder(admin, tenantA.tenantId, 1500);

    await admin.query(
      `insert into payments (tenant_id, order_id, provider, mollie_payment_id, amount_cents, currency)
       values ($1, $2, 'mollie', 'tr_test123', 1500, 'EUR')`,
      [tenantA.tenantId, orderId],
    );
    const row = await admin.query(
      `select provider, status, stripe_checkout_session_id, stripe_account_id from payments where order_id = $1`,
      [orderId],
    );
    expect(row.rows[0]).toEqual({
      provider: "mollie",
      status: "pending",
      stripe_checkout_session_id: null,
      stripe_account_id: null,
    });
  });

  it("rejects a mollie payment whose amount differs from the order total (server total is authoritative)", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    await insertMollieAccount(admin, tenantA.tenantId, "pfl_a");
    const orderId = await seedOrder(admin, tenantA.tenantId, 1500);

    await expect(
      admin.query(
        `insert into payments (tenant_id, order_id, provider, mollie_payment_id, amount_cents, currency)
         values ($1, $2, 'mollie', 'tr_wrongamt', 1, 'EUR')`,
        [tenantA.tenantId, orderId],
      ),
    ).rejects.toThrow(/must exactly match order/);
  });

  it("rejects a mollie payment for a tenant without a usable connection / PayPal", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    const orderA = await seedOrder(admin, tenantA.tenantId);
    const orderB = await seedOrder(admin, tenantB.tenantId);
    // Tenant B is connected but PayPal is not enabled; tenant A has no row at all.
    await insertMollieAccount(admin, tenantB.tenantId, "pfl_b", { paypalEnabled: false });

    await expect(
      admin.query(
        `insert into payments (tenant_id, order_id, provider, mollie_payment_id, amount_cents, currency)
         values ($1, $2, 'mollie', 'tr_noconn', 1500, 'EUR')`,
        [tenantA.tenantId, orderA],
      ),
    ).rejects.toThrow(/no usable Mollie connection/);
    await expect(
      admin.query(
        `insert into payments (tenant_id, order_id, provider, mollie_payment_id, amount_cents, currency)
         values ($1, $2, 'mollie', 'tr_nopaypal', 1500, 'EUR')`,
        [tenantB.tenantId, orderB],
      ),
    ).rejects.toThrow(/no usable Mollie connection/);
  });

  it("does not let tenant A's Mollie connection back a payment for tenant B's order", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA, tenantB } = fixture;
    await insertMollieAccount(admin, tenantA.tenantId, "pfl_a");
    const orderB = await seedOrder(admin, tenantB.tenantId);

    await expect(
      admin.query(
        `insert into payments (tenant_id, order_id, provider, mollie_payment_id, amount_cents, currency)
         values ($1, $2, 'mollie', 'tr_cross', 1500, 'EUR')`,
        [tenantA.tenantId, orderB],
      ),
    ).rejects.toThrow(/tenant_id must match its order/);
  });

  it("enforces the per-provider id shape and freezes provider/mollie_payment_id", async () => {
    fixture = await seedTwoTenantFixture(admin);
    const { tenantA } = fixture;
    await insertMollieAccount(admin, tenantA.tenantId, "pfl_a");
    const orderId = await seedOrder(admin, tenantA.tenantId);

    // A mollie row must not carry Stripe ids, and must have a tr_ id.
    await expect(
      admin.query(
        `insert into payments (tenant_id, order_id, provider, amount_cents, currency)
         values ($1, $2, 'mollie', 1500, 'EUR')`,
        [tenantA.tenantId, orderId],
      ),
    ).rejects.toThrow(/payments_provider_ids_check/);
    await expect(
      admin.query(
        `insert into payments (tenant_id, order_id, provider, mollie_payment_id, amount_cents, currency)
         values ($1, $2, 'mollie', 'cs_notmollie', 1500, 'EUR')`,
        [tenantA.tenantId, orderId],
      ),
    ).rejects.toThrow(/payments_mollie_payment_id_check/);

    const inserted = await admin.query<{ id: string }>(
      `insert into payments (tenant_id, order_id, provider, mollie_payment_id, amount_cents, currency)
       values ($1, $2, 'mollie', 'tr_frozen', 1500, 'EUR') returning id`,
      [tenantA.tenantId, orderId],
    );
    const paymentId = inserted.rows[0]!.id;

    await admin.query(`set role service_role`);
    try {
      await expect(
        admin.query(`update payments set mollie_payment_id = 'tr_other' where id = $1`, [
          paymentId,
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        admin.query(`update payments set provider = 'stripe' where id = $1`, [paymentId]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await admin.query(`reset role`);
    }
  });
});
