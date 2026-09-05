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

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const MOCK_ACCOUNT_ROW = {
  id: "account-1",
  provider_key: "mock",
  label: "Mock-Integration",
  status: "mock",
  created_at: "2026-08-20T09:00:00.000Z",
  updated_at: "2026-08-20T09:00:00.000Z",
};

const PUBLISHED_MENU = {
  tenant: { slug: "trattoria-bella", name: "Trattoria Bella", description: "", timezone: "Europe/Berlin", brandColor: "#000" },
  categories: [
    { id: "cat-1", name: "Pizza", dishes: [{ id: "dish-1", name: "Margherita", description: "", priceCents: 900, currency: "EUR", soldOut: false, image: null, variants: [], optionGroups: [], labels: [], allergenNotice: "" }] },
  ],
};

function membershipTable(
  data: { tenant_id: string; role: string } | null = { tenant_id: "tenant-1", role: "owner" },
) {
  return {
    select: () => ({
      eq: () => ({
        limit: () => ({
          maybeSingle: async () => ({ data, error: null }),
        }),
      }),
    }),
  };
}

function tenantsTable(data: { slug: string } | null = { slug: "trattoria-bella" }) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data, error: null }),
      }),
    }),
  };
}

function defaultRpcImplementation(fn: string, args?: Record<string, unknown>) {
  if (fn === "require_tenant_permission") return { data: null, error: null };
  if (fn === "create_integration_account") return { data: MOCK_ACCOUNT_ROW, error: null };
  if (fn === "get_public_menu") return { data: PUBLISHED_MENU, error: null };
  if (fn === "record_integration_sync_job") {
    return {
      data: {
        id: `job-${Math.random()}`,
        integration_account_id: "account-1",
        job_type: args?.p_job_type,
        status: "succeeded",
        payload: {},
        error_message: null,
        created_at: "2026-08-20T09:00:00.000Z",
        completed_at: "2026-08-20T09:00:00.000Z",
      },
      error: null,
    };
  }
  throw new Error(`unexpected rpc: ${fn}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  fromMock.mockImplementation((table: string) => {
    if (table === "tenant_memberships") return membershipTable();
    if (table === "tenants") return tenantsTable();
    throw new Error(`unexpected table: ${table}`);
  });
  rpcMock.mockImplementation(async (fn: string, args?: Record<string, unknown>) =>
    defaultRpcImplementation(fn, args),
  );
});

describe("exportMenuAction", () => {
  it("returns an error when the caller is not authenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const { exportMenuAction } = await import("./actions");
    const result = await exportMenuAction();

    expect(result.error).toBeDefined();
    expect(rpcMock).not.toHaveBeenCalledWith("create_integration_account", expect.anything());
  });

  it("returns an error when the caller has no tenant membership", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable(null);
      throw new Error(`unexpected table: ${table}`);
    });

    const { exportMenuAction } = await import("./actions");
    const result = await exportMenuAction();

    expect(result.error).toBeDefined();
  });

  // Permission-boundary denied case (`.claude/rules/testing.md`).
  it("denies a caller without integrations.manage, never calling create_integration_account", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: { message: "insufficient_privilege" } };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const { exportMenuAction } = await import("./actions");
    const result = await exportMenuAction();

    expect(result.error).toBeDefined();
    expect(rpcMock).not.toHaveBeenCalledWith("create_integration_account", expect.anything());
  });

  it("re-derives the tenant id from the caller's own session, ignoring any client-supplied value", async () => {
    let requestedTenantId: string | undefined;
    rpcMock.mockImplementation(async (fn: string, args: { p_tenant_id?: string }) => {
      if (fn === "require_tenant_permission") {
        requestedTenantId = args.p_tenant_id;
      }
      return defaultRpcImplementation(fn, args);
    });

    const { exportMenuAction } = await import("./actions");
    await exportMenuAction();

    expect(requestedTenantId).toBe("tenant-1");
  });

  it("acceptance criterion 1: exports the tenant's published menu and records a menu_export job", async () => {
    const { exportMenuAction } = await import("./actions");
    const result = await exportMenuAction();

    expect(result.error).toBeUndefined();
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs?.[0]?.jobType).toBe("menu_export");
    expect(result.jobs?.[0]?.status).toBe("succeeded");
  });

  it("returns a safe error when the tenant has no published menu", async () => {
    rpcMock.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "get_public_menu") return { data: null, error: { message: "not found" } };
      return defaultRpcImplementation(fn, args);
    });

    const { exportMenuAction } = await import("./actions");
    const result = await exportMenuAction();

    expect(result.error).toBe("Für dieses Restaurant ist noch keine Speisekarte veröffentlicht.");
  });
});

describe("simulateIncomingOrderAction", () => {
  it("denies a caller without integrations.manage", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: { message: "insufficient_privilege" } };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const { simulateIncomingOrderAction } = await import("./actions");
    const result = await simulateIncomingOrderAction();

    expect(result.error).toBeDefined();
    expect(rpcMock).not.toHaveBeenCalledWith("record_integration_sync_job", expect.anything());
  });

  it("acceptance criterion 1: triggers a simulated incoming order and its confirmation, recording both jobs", async () => {
    const { simulateIncomingOrderAction } = await import("./actions");
    const result = await simulateIncomingOrderAction();

    expect(result.error).toBeUndefined();
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs!.map((job) => job.jobType)).toEqual(["order_import", "order_confirmation"]);
    expect(result.jobs!.every((job) => job.status === "succeeded")).toBe(true);
  });
});
