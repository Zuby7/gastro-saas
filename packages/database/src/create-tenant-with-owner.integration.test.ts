// Integration test for ticket #7's registration/onboarding RPC
// (supabase/migrations/20260801060000_auth_onboarding_rpc_and_rate_limiting.sql).
//
// Unlike tenants.integration.test.ts (ticket #4) and audit-logs.integration.test.ts
// (ticket #6), which simulate an authenticated session directly at the
// DB/JWT-claims level via `set_config`, this test exercises the *real*
// Supabase Auth HTTP API (`supabase.auth.signUp()` against the local Kong
// gateway) to obtain a genuine session, then calls `create_tenant_with_owner`
// through that session via `.rpc()` -- proving the actual registration flow
// (Supabase Auth user -> tenant -> Owner membership, all atomic) works
// end-to-end, not just that the SQL function is well-formed.
//
// Same DB-probe/skip pattern as the other integration suites in this
// package: requires a real local Supabase stack (`supabase start`); skips
// locally with a warning if unreachable, throws in CI instead of silently
// skipping.
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const DB_URL =
  process.env.SUPABASE_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
// Local dev default anon key (matches .env.example) -- not a secret, only
// works against the local Docker stack.
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

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
      `[create-tenant-with-owner.integration.test] CI or SUPABASE_DB_URL is set, but no reachable ` +
        `Postgres was found at ${DB_URL}. Refusing to silently skip the registration/onboarding ` +
        "RPC suite in CI -- check the migration-check workflow's `supabase start` step.",
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[create-tenant-with-owner.integration.test] Skipping: no reachable Postgres at ${DB_URL}. ` +
      "Run `pnpm --filter @gastro-saas/database db:start` (requires a working local Docker setup) " +
      "to exercise this test locally, or rely on the migration-check CI workflow.",
  );
}

describe.skipIf(!dbAvailable)("ticket #7: create_tenant_with_owner onboarding RPC", () => {
  const admin = new Client({ connectionString: DB_URL });
  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    await admin.connect();
  });

  afterEach(async () => {
    // Tenants must be deleted before their owning auth.users row: deleting
    // the tenant first (cascades to tenant_memberships) means the deferred
    // "at least one Owner" trigger never has to run against a tenant that no
    // longer exists. Deleting the user first would instead cascade-delete
    // the Owner membership while the tenant still exists, tripping that
    // trigger at commit.
    if (createdTenantIds.length > 0) {
      await admin.query(`delete from tenants where id = any($1::uuid[])`, [createdTenantIds]);
      createdTenantIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await admin.query(`delete from auth.users where id = any($1::uuid[])`, [createdUserIds]);
      createdUserIds.length = 0;
    }
  });

  afterAll(async () => {
    await admin.end();
  });

  it("registers a real Supabase Auth user and atomically creates a tenant + Owner membership", async () => {
    const unique = randomUUID();
    const email = `owner-${unique}@example.test`;
    const password = "Sup3rSecurePassw0rd!";
    const tenantName = "Atomic Onboarding Tenant";
    const tenantSlug = `atomic-onboarding-${unique.slice(0, 8)}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });
    expect(signUpError).toBeNull();
    expect(
      signUpData.session,
      "local stack has auth.enable_confirmations = false, so signUp establishes a session immediately",
    ).not.toBeNull();
    expect(signUpData.user).not.toBeNull();
    createdUserIds.push(signUpData.user!.id);

    const { data: tenantId, error: rpcError } = await supabase.rpc("create_tenant_with_owner", {
      p_tenant_name: tenantName,
      p_tenant_slug: tenantSlug,
    });
    expect(rpcError).toBeNull();
    expect(typeof tenantId).toBe("string");
    createdTenantIds.push(tenantId as string);

    const membership = await admin.query(
      `select role from tenant_memberships where tenant_id = $1 and user_id = $2`,
      [tenantId, signUpData.user!.id],
    );
    expect(membership.rows).toHaveLength(1);
    expect(membership.rows[0]?.role).toBe("owner");

    const tenantRow = await admin.query(`select name, slug from tenants where id = $1`, [tenantId]);
    expect(tenantRow.rows[0]).toMatchObject({ name: tenantName, slug: tenantSlug });
  });

  it("never leaves a bare tenant behind if the RPC is called twice with the same slug (unique violation)", async () => {
    const unique = randomUUID();
    const email = `owner-${unique}@example.test`;
    const password = "Sup3rSecurePassw0rd!";
    const tenantSlug = `duplicate-slug-${unique.slice(0, 8)}`;

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signUpData } = await supabase.auth.signUp({ email, password });
    createdUserIds.push(signUpData.user!.id);

    const first = await supabase.rpc("create_tenant_with_owner", {
      p_tenant_name: "First Tenant",
      p_tenant_slug: tenantSlug,
    });
    expect(first.error).toBeNull();
    createdTenantIds.push(first.data as string);

    const secondEmail = `owner-second-${unique}@example.test`;
    const { data: secondSignUp } = await supabase.auth.signUp({
      email: secondEmail,
      password,
    });
    createdUserIds.push(secondSignUp.user!.id);
    const secondClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await secondClient.auth.setSession({
      access_token: secondSignUp.session!.access_token,
      refresh_token: secondSignUp.session!.refresh_token,
    });

    const second = await secondClient.rpc("create_tenant_with_owner", {
      p_tenant_name: "Second Tenant",
      p_tenant_slug: tenantSlug,
    });
    expect(second.error).not.toBeNull();

    const orphanTenants = await admin.query(`select id from tenants where slug = $1`, [tenantSlug]);
    expect(orphanTenants.rows).toHaveLength(1);
    expect(orphanTenants.rows[0]?.id).toBe(first.data);
  });

  it("rejects calling create_tenant_with_owner without an authenticated session", async () => {
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const unique = randomUUID().slice(0, 8);
    const { error } = await anonClient.rpc("create_tenant_with_owner", {
      p_tenant_name: "Should Not Exist",
      p_tenant_slug: `should-not-exist-${unique}`,
    });

    expect(error).not.toBeNull();

    const found = await admin.query(`select id from tenants where slug = $1`, [
      `should-not-exist-${unique}`,
    ]);
    expect(found.rows).toHaveLength(0);
  });
});
