import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionDeniedError } from "@/lib/auth/permissions";
import { MOLLIE_NONCE_COOKIE } from "@/lib/mollie/connection";
import { verifyMollieOAuthState } from "@/lib/mollie/oauth-state";

const getUserMock = vi.fn();
const membershipMock = vi.fn();
const requirePermissionMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: getUserMock } }),
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

import { GET } from "./route";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
  vi.stubEnv("MOLLIE_CLIENT_ID", "app_id");
  vi.stubEnv("MOLLIE_CLIENT_SECRET", "secret");
  vi.stubEnv("MOLLIE_TOKEN_KEY", Buffer.alloc(32, 7).toString("base64"));
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: "user-1" } } });
  membershipMock.mockReset().mockResolvedValue({ tenantId: "tenant-1", role: "owner" });
  requirePermissionMock.mockReset().mockResolvedValue(undefined);
});

describe("GET /account/payments/mollie/connect", () => {
  it("redirects to Mollie with a signed state bound to the session tenant and user, plus a nonce cookie", async () => {
    const response = await GET();
    const location = new URL(response.headers.get("location") as string);

    expect(location.origin + location.pathname).toBe("https://my.mollie.com/oauth2/authorize");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://app.example/account/payments/mollie/callback",
    );
    const payload = await verifyMollieOAuthState(location.searchParams.get("state"));
    expect(payload).toMatchObject({ tenantId: "tenant-1", userId: "user-1" });
    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
      "payments.connect",
    );

    const setCookie = response.headers.get("set-cookie") as string;
    expect(setCookie).toContain(`${MOLLIE_NONCE_COOKIE}=${payload?.nonce}`);
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("denies members without payments.connect", async () => {
    requirePermissionMock.mockRejectedValue(
      new PermissionDeniedError("tenant-1", "payments.connect"),
    );
    const response = await GET();
    expect(new URL(response.headers.get("location") as string).searchParams.get("mollie")).toBe(
      "forbidden",
    );
  });

  it("requires a session", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const response = await GET();
    expect(new URL(response.headers.get("location") as string).pathname).toBe("/login");
  });

  it("fails closed when Mollie OAuth is not configured", async () => {
    vi.stubEnv("MOLLIE_CLIENT_ID", "");
    const response = await GET();
    expect(new URL(response.headers.get("location") as string).searchParams.get("mollie")).toBe(
      "unavailable",
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
