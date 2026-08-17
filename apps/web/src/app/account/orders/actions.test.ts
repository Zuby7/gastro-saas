import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const transitionOrderStatusMock = vi.fn();

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

vi.mock("@/lib/audit/record-menu-admin-audit-event", () => ({
  recordMenuAdminAuditEvent: vi.fn(),
}));

vi.mock("@/lib/orders/status-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orders/status-service")>(
    "@/lib/orders/status-service",
  );
  return {
    ...actual,
    transitionOrderStatus: (...args: unknown[]) => transitionOrderStatusMock(...args),
  };
});

function membershipTable(
  data: { tenant_id: string; role: string } | null = {
    tenant_id: "tenant-1",
    role: "owner",
  },
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

function ordersTable(rows: unknown[] = []) {
  return {
    select: () => ({
      eq: () => ({
        in: () => ({
          order: () => ({
            limit: () => ({
              returns: async () => ({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  fromMock.mockImplementation((table: string) => {
    if (table === "tenant_memberships") return membershipTable();
    if (table === "orders") return ordersTable([]);
    throw new Error(`unexpected table: ${table}`);
  });
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === "require_tenant_permission") return { data: null, error: null };
    if (fn === "has_tenant_permission") return { data: true, error: null };
    if (fn === "get_tenant_order_payment_statuses") return { data: [], error: null };
    throw new Error(`unexpected rpc: ${fn}`);
  });
  transitionOrderStatusMock.mockResolvedValue("accepted");
});

describe("pollTenantOrders", () => {
  it("returns null when the caller is not authenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const { pollTenantOrders } = await import("./actions");
    expect(await pollTenantOrders()).toBeNull();
    expect(fromMock).not.toHaveBeenCalledWith("orders");
  });

  it("returns null when the caller has no tenant membership", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable(null);
      throw new Error(`unexpected table: ${table}`);
    });

    const { pollTenantOrders } = await import("./actions");
    expect(await pollTenantOrders()).toBeNull();
  });

  it("returns null when the caller lacks orders.read (permission-denied case), never leaking order rows", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: { message: "insufficient_privilege" } };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const { pollTenantOrders } = await import("./actions");
    const result = await pollTenantOrders();

    expect(result).toBeNull();
  });

  it("re-derives the tenant id from the caller's own session, ignoring any client-supplied value", async () => {
    let queriedTenantId: string | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships")
        return membershipTable({ tenant_id: "tenant-1", role: "owner" });
      if (table === "orders") {
        return {
          select: () => ({
            eq: (_column: string, value: string) => {
              queriedTenantId = value;
              return {
                in: () => ({
                  order: () => ({
                    limit: () => ({
                      returns: async () => ({ data: [], error: null }),
                    }),
                  }),
                }),
              };
            },
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { pollTenantOrders } = await import("./actions");
    await pollTenantOrders();

    expect(queriedTenantId).toBe("tenant-1");
  });

  // Epic 8 Opus batch review, finding 9: pollTenantOrders(limit) had no
  // upper bound -- a caller-supplied huge limit was forwarded straight to
  // the database query.
  it("clamps an oversized limit server-side instead of forwarding it to the database query", async () => {
    let queriedLimit: number | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: (value: number) => {
                    queriedLimit = value;
                    return { returns: async () => ({ data: [], error: null }) };
                  },
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { pollTenantOrders } = await import("./actions");
    await pollTenantOrders(10_000_000);

    // MAX_ORDER_DASHBOARD_PAGE_SIZE (500) + 1 -- the dashboard service's own
    // "fetch limit + 1 to detect hasMore" strategy.
    expect(queriedLimit).toBe(501);
  });

  it("clamps a zero/negative limit up to at least 1", async () => {
    let queriedLimit: number | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "orders") {
        return {
          select: () => ({
            eq: () => ({
              in: () => ({
                order: () => ({
                  limit: (value: number) => {
                    queriedLimit = value;
                    return { returns: async () => ({ data: [], error: null }) };
                  },
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { pollTenantOrders } = await import("./actions");
    await pollTenantOrders(-5);

    expect(queriedLimit).toBe(2);
  });

  // Epic 8 Opus batch review, finding 7: total_cents is a payments.read-gated
  // concern -- Kitchen/Service hold orders.read but not payments.read.
  it("omits totalCents when the caller lacks payments.read", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "has_tenant_permission") return { data: false, error: null };
      if (fn === "get_tenant_order_payment_statuses") return { data: [], error: null };
      throw new Error(`unexpected rpc: ${fn}`);
    });
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "orders") {
        return ordersTable([
          {
            id: "order-1",
            status: "received",
            fulfillment_type: "pickup",
            customer_name: "Max Mustermann",
            table_identifier: null,
            total_cents: 1290,
            currency: "EUR",
            created_at: new Date().toISOString(),
          },
        ]);
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { pollTenantOrders } = await import("./actions");
    const result = await pollTenantOrders();

    expect(result?.orders[0]?.totalCents).toBeNull();
  });

  it("includes totalCents when the caller holds payments.read", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "orders") {
        return ordersTable([
          {
            id: "order-1",
            status: "received",
            fulfillment_type: "pickup",
            customer_name: "Max Mustermann",
            table_identifier: null,
            total_cents: 1290,
            currency: "EUR",
            created_at: new Date().toISOString(),
          },
        ]);
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { pollTenantOrders } = await import("./actions");
    const result = await pollTenantOrders();

    expect(result?.orders[0]?.totalCents).toBe(1290);
  });
});

// Epic 8 Opus batch review, finding 4: cancellation requires orders.cancel
// in addition to orders.manage -- previously orders.manage alone was
// sufficient, even though the board's UI never actually renders a cancel
// button here (UI hiding is never authorization).
describe("transitionOrderStatusAction", () => {
  it("requires orders.cancel (in addition to orders.manage) when transitioning to 'cancelled'", async () => {
    const requestedPermissions: string[] = [];
    rpcMock.mockImplementation(async (fn: string, args: { p_permission_key: string }) => {
      if (fn === "require_tenant_permission") {
        requestedPermissions.push(args.p_permission_key);
        if (args.p_permission_key === "orders.cancel") {
          return { data: null, error: { message: "insufficient_privilege" } };
        }
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const { transitionOrderStatusAction } = await import("./actions");
    const result = await transitionOrderStatusAction("order-1", "cancelled");

    expect(requestedPermissions).toEqual(["orders.manage", "orders.cancel"]);
    expect(result.error).toBeDefined();
    expect(transitionOrderStatusMock).not.toHaveBeenCalled();
  });

  it("does not require orders.cancel for a non-cancellation transition", async () => {
    const requestedPermissions: string[] = [];
    rpcMock.mockImplementation(async (fn: string, args: { p_permission_key: string }) => {
      if (fn === "require_tenant_permission") {
        requestedPermissions.push(args.p_permission_key);
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const { transitionOrderStatusAction } = await import("./actions");
    const result = await transitionOrderStatusAction("order-1", "accepted");

    expect(requestedPermissions).toEqual(["orders.manage"]);
    expect(result.status).toBe("accepted");
    expect(transitionOrderStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: "order-1", toStatus: "accepted" }),
    );
  });

  it("succeeds cancelling when the caller holds both orders.manage and orders.cancel", async () => {
    transitionOrderStatusMock.mockResolvedValue("cancelled");

    const { transitionOrderStatusAction } = await import("./actions");
    const result = await transitionOrderStatusAction("order-1", "cancelled");

    expect(result.status).toBe("cancelled");
    expect(transitionOrderStatusMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderId: "order-1", toStatus: "cancelled" }),
    );
  });
});
