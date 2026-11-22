import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "@/lib/auth/permissions";
import { MOLLIE_NONCE_COOKIE } from "@/lib/mollie/connection";
import { signMollieOAuthState } from "@/lib/mollie/oauth-state";

const getUserMock = vi.fn();
const membershipMock = vi.fn();
const requirePermissionMock = vi.fn();
const upsertMock = vi.fn();
const exchangeMock = vi.fn();
const profileMock = vi.fn();
const orgMock = vi.fn();
const paypalMock = vi.fn();
const auditMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: getUserMock } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("tenant_mollie_accounts");
      return { upsert: (...args: unknown[]) => upsertMock(...args) };
    },
  }),
}));
vi.mock("@/lib/tenant/current-membership", () => ({
  getCurrentMembership: (...args: unknown[]) => membershipMock(...args),
}));
vi.mock("@/lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/permissions")>();
  return {
    ...actual,
    requireTenantPermission: (...args: unknown[]) => requirePermissionMock(...args),
  };
});
vi.mock("@/lib/audit/record-menu-admin-audit-event", () => ({
  recordMenuAdminAuditEvent: (...args: unknown[]) => auditMock(...args),
}));
vi.mock("@/lib/mollie/client", () => ({
  exchangeMollieAuthorizationCode: (...args: unknown[]) => exchangeMock(...args),
  getMollieCurrentProfile: (...args: unknown[]) => profileMock(...args),
  getMollieOrganizationId: (...args: unknown[]) => orgMock(...args),
  isMolliePaypalEnabled: (...args: unknown[]) => paypalMock(...args),
}));

import { GET } from "./route";

const ORIGIN = "https://app.example";

async function callback(options: {
  state?: string | null;
  code?: string | null;
  error?: string;
  nonceCookie?: string | null;
}) {
  const url = new URL(`${ORIGIN}/account/payments/mollie/callback`);
  if (options.state) url.searchParams.set("state", options.state);
  if (options.code) url.searchParams.set("code", options.code);
  if (options.error) url.searchParams.set("error", options.error);
  const headers: Record<string, string> = {};
  if (options.nonceCookie) headers.cookie = `${MOLLIE_NONCE_COOKIE}=${options.nonceCookie}`;
  return GET(new NextRequest(url, { headers }));
}

const flash = (response: Response) =>
  new URL(response.headers.get("location") as string).searchParams.get("mollie");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  vi.stubEnv("MOLLIE_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
  [
    getUserMock,
    membershipMock,
    requirePermissionMock,
    upsertMock,
    exchangeMock,
    profileMock,
    orgMock,
    paypalMock,
    auditMock,
  ].forEach((m) => m.mockReset());
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  membershipMock.mockResolvedValue({ tenantId: "tenant-1", role: "owner" });
  requirePermissionMock.mockResolvedValue(undefined);
  upsertMock.mockResolvedValue({ error: null });
  exchangeMock.mockResolvedValue({
    accessToken: "plain-access",
    refreshToken: "plain-refresh",
    expiresInSeconds: 3600,
  });
  profileMock.mockResolvedValue({ id: "pfl_1" });
  orgMock.mockResolvedValue("org_1");
  paypalMock.mockResolvedValue(true);
});

describe("GET /account/payments/mollie/callback", () => {
  it("stores ENCRYPTED tokens for the session's tenant and redirects with success", async () => {
    const state = await signMollieOAuthState({
      tenantId: "tenant-1",
      userId: "user-1",
      nonce: "n1",
    });
    const response = await callback({ state, code: "auth-code", nonceCookie: "n1" });

    expect(flash(response)).toBe("connected");
    expect(exchangeMock).toHaveBeenCalledWith({
      code: "auth-code",
      redirectUri: `${ORIGIN}/account/payments/mollie/callback`,
    });
    expect(upsertMock).toHaveBeenCalledOnce();
    const [row, options] = upsertMock.mock.calls[0] as [Record<string, string>, unknown];
    expect(options).toEqual({ onConflict: "tenant_id" });
    expect(row).toMatchObject({
      tenant_id: "tenant-1",
      mollie_profile_id: "pfl_1",
      mollie_organization_id: "org_1",
      status: "connected",
      paypal_enabled: true,
      created_by_user_id: "user-1",
    });
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("plain-access");
    expect(serialized).not.toContain("plain-refresh");
    expect(row.access_token_ciphertext).toBeTruthy();
    expect(row.refresh_token_iv).toBeTruthy();
    // Redirect never carries tokens or the code.
    expect(response.headers.get("location")).not.toContain("plain-");
    expect(response.headers.get("location")).not.toContain("auth-code");
  });

  it("reports connected_no_paypal when PayPal is not activated at Mollie yet", async () => {
    paypalMock.mockResolvedValue(false);
    const state = await signMollieOAuthState({
      tenantId: "tenant-1",
      userId: "user-1",
      nonce: "n1",
    });
    const response = await callback({ state, code: "c", nonceCookie: "n1" });
    expect(flash(response)).toBe("connected_no_paypal");
    expect((upsertMock.mock.calls[0]?.[0] as { paypal_enabled: boolean }).paypal_enabled).toBe(
      false,
    );
  });

  it("rejects a missing, forged or garbage state without exchanging the code", async () => {
    for (const state of [null, "garbage", "a.b"]) {
      const response = await callback({ state, code: "c", nonceCookie: "n1" });
      expect(flash(response)).toBe("invalid_state");
    }
    expect(exchangeMock).not.toHaveBeenCalled();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects an expired state", async () => {
    const state = await signMollieOAuthState(
      { tenantId: "tenant-1", userId: "user-1", nonce: "n1" },
      Date.now() - 60 * 60 * 1000,
    );
    const response = await callback({ state, code: "c", nonceCookie: "n1" });
    expect(flash(response)).toBe("invalid_state");
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("rejects a state bound to a different user (state mismatch)", async () => {
    const state = await signMollieOAuthState({
      tenantId: "tenant-1",
      userId: "attacker",
      nonce: "n1",
    });
    const response = await callback({ state, code: "c", nonceCookie: "n1" });
    expect(flash(response)).toBe("invalid_state");
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("rejects a state bound to a different tenant than the session's", async () => {
    const state = await signMollieOAuthState({
      tenantId: "tenant-2",
      userId: "user-1",
      nonce: "n1",
    });
    const response = await callback({ state, code: "c", nonceCookie: "n1" });
    expect(flash(response)).toBe("invalid_state");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("rejects when the nonce cookie is missing or does not match", async () => {
    const state = await signMollieOAuthState({
      tenantId: "tenant-1",
      userId: "user-1",
      nonce: "n1",
    });
    expect(flash(await callback({ state, code: "c", nonceCookie: null }))).toBe("invalid_state");
    expect(flash(await callback({ state, code: "c", nonceCookie: "other" }))).toBe("invalid_state");
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("denies members without payments.connect", async () => {
    requirePermissionMock.mockRejectedValue(
      new PermissionDeniedError("tenant-1", "payments.connect"),
    );
    const state = await signMollieOAuthState({
      tenantId: "tenant-1",
      userId: "user-1",
      nonce: "n1",
    });
    const response = await callback({ state, code: "c", nonceCookie: "n1" });
    expect(flash(response)).toBe("forbidden");
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated callers to login", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const response = await callback({ state: "x", code: "c" });
    expect(new URL(response.headers.get("location") as string).pathname).toBe("/login");
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("handles the user denying access at Mollie", async () => {
    const state = await signMollieOAuthState({
      tenantId: "tenant-1",
      userId: "user-1",
      nonce: "n1",
    });
    const response = await callback({ state, error: "access_denied", nonceCookie: "n1" });
    expect(flash(response)).toBe("denied");
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("fails closed (no row written) when the token key is missing, without leaking details", async () => {
    vi.stubEnv("MOLLIE_TOKEN_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    // state signing needs the key too, so sign first with a key then unset it
    vi.stubEnv("MOLLIE_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
    const state = await signMollieOAuthState({
      tenantId: "tenant-1",
      userId: "user-1",
      nonce: "n1",
    });
    // Valid for state verification, but encryption must still fail closed when the key vanishes:
    exchangeMock.mockImplementation(async () => {
      vi.stubEnv("MOLLIE_TOKEN_KEY", "");
      return { accessToken: "a", refreshToken: "r", expiresInSeconds: 10 };
    });
    const response = await callback({ state, code: "c", nonceCookie: "n1" });
    expect(flash(response)).toBe("failed");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("reports failure when the token exchange fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    exchangeMock.mockRejectedValue(new Error("exchange failed"));
    const state = await signMollieOAuthState({
      tenantId: "tenant-1",
      userId: "user-1",
      nonce: "n1",
    });
    const response = await callback({ state, code: "c", nonceCookie: "n1" });
    expect(flash(response)).toBe("failed");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("clears the single-use nonce cookie on every outcome", async () => {
    const response = await callback({ state: "bad", code: "c", nonceCookie: "n1" });
    expect(response.headers.get("set-cookie")).toContain(`${MOLLIE_NONCE_COOKIE}=;`);
  });
});
