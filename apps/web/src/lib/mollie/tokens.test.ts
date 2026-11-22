import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MollieApiError } from "./client";
import {
  MollieNotConnectedError,
  buildEncryptedTokenColumns,
  getMollieAccessForTenant,
  isTenantPaypalAvailable,
} from "./tokens";

const refreshMock = vi.fn();
vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, refreshMollieAccessToken: (...args: unknown[]) => refreshMock(...args) };
});

function fakeAdmin(row: Record<string, unknown> | null) {
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from: (table: string) => {
      expect(table).toBe("tenant_mollie_accounts");
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  return { admin: admin as unknown as SupabaseClient, updates };
}

describe("mollie token storage", () => {
  beforeEach(() => {
    vi.stubEnv("MOLLIE_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
    refreshMock.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  async function rowFor(expiresInSeconds: number, status = "connected") {
    const columns = await buildEncryptedTokenColumns("tenant-1", {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresInSeconds,
    });
    return { mollie_profile_id: "pfl_1", status, ...columns };
  }

  it("never stores plaintext tokens", async () => {
    const row = await rowFor(3600);
    expect(JSON.stringify(row)).not.toContain("access-1");
    expect(JSON.stringify(row)).not.toContain("refresh-1");
  });

  it("returns the decrypted access token when it is still valid", async () => {
    const { admin, updates } = fakeAdmin(await rowFor(3600));
    await expect(getMollieAccessForTenant(admin, "tenant-1")).resolves.toEqual({
      accessToken: "access-1",
      profileId: "pfl_1",
    });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("refreshes an expired token and persists the rotated tokens encrypted", async () => {
    refreshMock.mockResolvedValue({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresInSeconds: 3600,
    });
    const { admin, updates } = fakeAdmin(await rowFor(-10));
    const access = await getMollieAccessForTenant(admin, "tenant-1");
    expect(refreshMock).toHaveBeenCalledWith("refresh-1");
    expect(access.accessToken).toBe("access-2");
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0])).not.toContain("access-2");
    expect(JSON.stringify(updates[0])).not.toContain("refresh-2");
    expect(updates[0]).toHaveProperty("access_token_ciphertext");
  });

  it.each([
    ["invalid_grant", new MollieApiError("nope", 400, "invalid_grant")],
    ["401", new MollieApiError("nope", 401)],
  ])("flags needs_reauth when Mollie rejects the grant (%s)", async (_name, rejection) => {
    refreshMock.mockRejectedValue(rejection);
    const { admin, updates } = fakeAdmin(await rowFor(-10));
    await expect(getMollieAccessForTenant(admin, "tenant-1")).rejects.toBeInstanceOf(
      MollieNotConnectedError,
    );
    expect(updates).toEqual([{ status: "needs_reauth" }]);
  });

  it.each([
    ["429", new MollieApiError("rate", 429)],
    ["400 other", new MollieApiError("bad", 400, "invalid_request")],
    ["503", new MollieApiError("down", 503)],
    ["network", new MollieApiError("net", 0)],
  ])("does NOT flag needs_reauth for a transient failure (%s)", async (_name, failure) => {
    refreshMock.mockRejectedValue(failure);
    const { admin, updates } = fakeAdmin(await rowFor(-10));
    await expect(getMollieAccessForTenant(admin, "tenant-1")).rejects.toBe(failure);
    expect(updates).toHaveLength(0);
  });

  it("keeps the stored refresh token when the refresh response omits one", async () => {
    refreshMock.mockResolvedValue({
      accessToken: "access-2",
      refreshToken: "refresh-1",
      expiresInSeconds: 3600,
    });
    const { admin } = fakeAdmin(await rowFor(-10));
    await expect(getMollieAccessForTenant(admin, "tenant-1")).resolves.toMatchObject({
      accessToken: "access-2",
    });
  });

  it("propagates ambiguous refresh failures without flagging", async () => {
    refreshMock.mockRejectedValue(new MollieApiError("down", 503));
    const { admin, updates } = fakeAdmin(await rowFor(-10));
    await expect(getMollieAccessForTenant(admin, "tenant-1")).rejects.toBeInstanceOf(
      MollieApiError,
    );
    expect(updates).toHaveLength(0);
  });

  it("refuses a missing or non-connected account", async () => {
    await expect(getMollieAccessForTenant(fakeAdmin(null).admin, "t")).rejects.toBeInstanceOf(
      MollieNotConnectedError,
    );
    const { admin } = fakeAdmin(await rowFor(3600, "needs_reauth"));
    await expect(getMollieAccessForTenant(admin, "tenant-1")).rejects.toBeInstanceOf(
      MollieNotConnectedError,
    );
  });

  it("refuses tokens that were encrypted for another tenant", async () => {
    const { admin } = fakeAdmin(await rowFor(3600));
    await expect(getMollieAccessForTenant(admin, "tenant-2")).rejects.toThrow();
  });

  it("reports PayPal availability only for connected + enabled accounts", async () => {
    expect(await isTenantPaypalAvailable(fakeAdmin(null).admin, "t")).toBe(false);
    expect(
      await isTenantPaypalAvailable(
        fakeAdmin({ status: "connected", paypal_enabled: false }).admin,
        "t",
      ),
    ).toBe(false);
    expect(
      await isTenantPaypalAvailable(
        fakeAdmin({ status: "needs_reauth", paypal_enabled: true }).admin,
        "t",
      ),
    ).toBe(false);
    expect(
      await isTenantPaypalAvailable(
        fakeAdmin({ status: "connected", paypal_enabled: true }).admin,
        "t",
      ),
    ).toBe(true);
  });
});
