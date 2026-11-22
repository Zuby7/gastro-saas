import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
    rpc: rpcMock,
  }),
}));

function membershipQueryBuilder(result: { data: { tenant_id: string; role: string } | null }) {
  return {
    select: () => ({
      eq: () => ({
        limit: () => ({
          maybeSingle: async () => ({ data: result.data, error: null }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fromMock.mockImplementation(() =>
    membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } }),
  );
});

describe("GET /api/account/privacy/export", () => {
  it("returns 401 for an unauthenticated request", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(401);
  });

  // Issue #204 (audit 2026-11): the export is Owner-only. A Manager holds
  // tenant.settings.write but not tenant.data.delete and must be refused.
  it("returns 403 for a caller who holds tenant.settings.write but not the Owner-only tenant.data.delete", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    fromMock.mockImplementation(() =>
      membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "manager" } }),
    );
    rpcMock.mockImplementation((name: string, args: { p_permission_key?: string }) => {
      if (name === "require_tenant_permission") {
        return Promise.resolve(
          args.p_permission_key === "tenant.settings.write"
            ? { data: null, error: null }
            : { data: null, error: { message: "insufficient_privilege" } },
        );
      }
      return Promise.resolve({ data: { tenantId: "tenant-1" }, error: null });
    });

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(403);
    expect(rpcMock).toHaveBeenCalledWith("require_tenant_permission", {
      p_tenant_id: "tenant-1",
      p_permission_key: "tenant.data.delete",
    });
    expect(rpcMock).not.toHaveBeenCalledWith("export_tenant_data", expect.anything());
  });

  it("returns the tenant-scoped export as a downloadable JSON file when authorized", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    rpcMock.mockImplementation((name: string) => {
      if (name === "require_tenant_permission") {
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "export_tenant_data") {
        return Promise.resolve({ data: { tenantId: "tenant-1", orders: [] }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    const body = await response.json();
    expect(body).toMatchObject({ tenantId: "tenant-1" });
    expect(rpcMock).toHaveBeenCalledWith("export_tenant_data", { p_tenant_id: "tenant-1" });
    expect(rpcMock).toHaveBeenCalledWith("require_tenant_permission", {
      p_tenant_id: "tenant-1",
      p_permission_key: "tenant.data.delete",
    });
  });
});
