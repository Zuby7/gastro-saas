import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "@/lib/auth/permissions";
import { MollieNotConnectedError } from "@/lib/mollie/tokens";

const getUserMock = vi.fn();
const membershipMock = vi.fn();
const requirePermissionMock = vi.fn();
const auditMock = vi.fn();
const revokeMock = vi.fn();
const paypalMock = vi.fn();
const getAccessMock = vi.fn();
const decryptMock = vi.fn();
const deleteEqMock = vi.fn();
const updateMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ redirect: (url: string) => redirectMock(url) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: getUserMock } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { refresh_token_ciphertext: "ct", refresh_token_iv: "iv" },
          }),
        }),
      }),
      delete: () => ({ eq: (...args: unknown[]) => deleteEqMock(...args) }),
      update: (values: unknown) => ({
        eq: async () => {
          updateMock(values);
          return { error: null };
        },
      }),
    }),
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
  revokeMollieToken: (...args: unknown[]) => revokeMock(...args),
  isMolliePaypalEnabled: (...args: unknown[]) => paypalMock(...args),
}));
vi.mock("@/lib/mollie/crypto", () => ({
  decryptSecret: (...args: unknown[]) => decryptMock(...args),
}));
vi.mock("@/lib/mollie/tokens", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mollie/tokens")>();
  return { ...actual, getMollieAccessForTenant: (...args: unknown[]) => getAccessMock(...args) };
});

import { disconnectMollieAction, refreshMolliePaypalStatusAction } from "./mollie-actions";

const denied = () =>
  requirePermissionMock.mockRejectedValue(
    new PermissionDeniedError("tenant-1", "payments.connect"),
  );

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  membershipMock.mockResolvedValue({ tenantId: "tenant-1", role: "owner" });
  requirePermissionMock.mockResolvedValue(undefined);
  deleteEqMock.mockResolvedValue({ error: null });
  decryptMock.mockResolvedValue("refresh-plain");
  revokeMock.mockResolvedValue(true);
  getAccessMock.mockResolvedValue({ accessToken: "tok", profileId: "pfl_1" });
  paypalMock.mockResolvedValue(true);
});

describe("disconnectMollieAction", () => {
  it("requires payments.connect server-side and changes nothing when denied", async () => {
    denied();
    const result = await disconnectMollieAction({}, new FormData());
    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(deleteEqMock).not.toHaveBeenCalled();
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated callers to login", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    await expect(disconnectMollieAction({}, new FormData())).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
  });

  it("revokes the token (best effort), deletes the tenant's row from the session tenant and audits", async () => {
    const result = await disconnectMollieAction({}, new FormData());
    expect(result.message).toContain("getrennt");
    expect(revokeMock).toHaveBeenCalledWith("refresh-plain", "refresh_token");
    expect(deleteEqMock).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(auditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "mollie_account.disconnected", tenantId: "tenant-1" }),
    );
  });

  it("still disconnects when revocation or decryption fails", async () => {
    decryptMock.mockRejectedValue(new Error("key missing"));
    const result = await disconnectMollieAction({}, new FormData());
    expect(result.message).toContain("getrennt");
    expect(deleteEqMock).toHaveBeenCalled();
  });

  it("reports a delete failure", async () => {
    deleteEqMock.mockResolvedValue({ error: { message: "db" } });
    const result = await disconnectMollieAction({}, new FormData());
    expect(result.error).toContain("konnte nicht getrennt werden");
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe("refreshMolliePaypalStatusAction", () => {
  it("denies members without payments.connect", async () => {
    denied();
    const result = await refreshMolliePaypalStatusAction({}, new FormData());
    expect(result.error).toBeTruthy();
    expect(paypalMock).not.toHaveBeenCalled();
  });

  it("stores the fresh PayPal flag", async () => {
    paypalMock.mockResolvedValue(false);
    const result = await refreshMolliePaypalStatusAction({}, new FormData());
    expect(paypalMock).toHaveBeenCalledWith("tok", "pfl_1");
    expect(updateMock).toHaveBeenCalledWith({ paypal_enabled: false });
    expect(result.message).toContain("noch nicht aktiviert");
  });

  it("asks to reconnect when the connection is not active", async () => {
    getAccessMock.mockRejectedValue(new MollieNotConnectedError());
    const result = await refreshMolliePaypalStatusAction({}, new FormData());
    expect(result.error).toContain("neu verbinden");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns a generic error for unexpected failures without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    paypalMock.mockRejectedValue(new Error("Bearer tok exploded"));
    const result = await refreshMolliePaypalStatusAction({}, new FormData());
    expect(result.error).not.toContain("tok");
  });
});
