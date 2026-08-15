// Integration tests for `claim_payment_webhook_event()` (epic-7 batch review
// cycle-2 SHOULD-fix: this RPC was previously only exercised via mocks in the
// two webhook route test files -- this suite calls the real function against
// a live database). Same DB-probe/skip pattern as the other database
// integration suites.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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
    throw new Error(`[payment-webhook-events.integration.test] no reachable Postgres at ${DB_URL}.`);
  }
  console.warn(
    `[payment-webhook-events.integration.test] Skipping: no reachable Postgres at ${DB_URL}.`,
  );
}

describe.skipIf(!dbAvailable)("claim_payment_webhook_event()", () => {
  const admin = new Client({ connectionString: DB_URL });
  let eventId: string;

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    await admin.query(`delete from payment_webhook_events where stripe_event_id = $1`, [eventId]);
  });

  afterAll(async () => {
    await admin.end();
  });

  it("claims a first-ever delivery (inserts, returns already_processed = false)", async () => {
    eventId = `evt_${randomUUID()}`;

    const result = await admin.query<{ already_processed: boolean }>(
      `select already_processed from claim_payment_webhook_event($1, $2, $3)`,
      [eventId, "acct_test", "account.updated"],
    );

    expect(result.rows[0]?.already_processed).toBe(false);

    const row = await admin.query<{ processed_at: string | null }>(
      `select processed_at from payment_webhook_events where stripe_event_id = $1`,
      [eventId],
    );
    expect(row.rows[0]?.processed_at).toBeNull();
  });

  it("re-claims (reprocesses) a retry of a row that never reached processed_at", async () => {
    eventId = `evt_${randomUUID()}`;

    const first = await admin.query<{ already_processed: boolean }>(
      `select already_processed from claim_payment_webhook_event($1, $2, $3)`,
      [eventId, "acct_test", "account.updated"],
    );
    expect(first.rows[0]?.already_processed).toBe(false);

    // Simulates a crash/DB blip between claim and the caller setting
    // processed_at -- a genuine Stripe retry of the *same* event id must
    // still be claimable, not permanently swallowed.
    const retry = await admin.query<{ already_processed: boolean }>(
      `select already_processed from claim_payment_webhook_event($1, $2, $3)`,
      [eventId, "acct_test", "account.updated"],
    );
    expect(retry.rows[0]?.already_processed).toBe(false);

    const row = await admin.query<{ processed_at: string | null }>(
      `select processed_at from payment_webhook_events where stripe_event_id = $1`,
      [eventId],
    );
    expect(row.rows[0]?.processed_at).toBeNull();
  });

  it("treats a retry of a genuinely completed event as a no-op duplicate", async () => {
    eventId = `evt_${randomUUID()}`;

    await admin.query(`select claim_payment_webhook_event($1, $2, $3)`, [
      eventId,
      "acct_test",
      "account.updated",
    ]);
    await admin.query(`update payment_webhook_events set processed_at = now() where stripe_event_id = $1`, [
      eventId,
    ]);

    const retry = await admin.query<{ already_processed: boolean }>(
      `select already_processed from claim_payment_webhook_event($1, $2, $3)`,
      [eventId, "acct_test", "account.updated"],
    );
    expect(retry.rows[0]?.already_processed).toBe(true);

    // The already-processed row must be left untouched -- a duplicate
    // delivery's (possibly different) event_type/account must not overwrite
    // the record of what was actually processed.
    const row = await admin.query<{ event_type: string; processed_at: string | null }>(
      `select event_type, processed_at from payment_webhook_events where stripe_event_id = $1`,
      [eventId],
    );
    expect(row.rows[0]?.event_type).toBe("account.updated");
    expect(row.rows[0]?.processed_at).not.toBeNull();
  });
});
