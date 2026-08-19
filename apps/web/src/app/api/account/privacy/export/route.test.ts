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

  it("returns 403 when the caller lacks tenant.settings.write", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    rpcMock.mockResolvedValue({ data: null, error: { message: "insufficient_privilege" } });

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(403);
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
  });
});
