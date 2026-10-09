import { beforeEach, describe, expect, it, vi } from "vitest";

const hasTenantPermissionMock = vi.fn();

vi.mock("@/lib/auth/permissions", () => ({
  hasTenantPermission: (...args: unknown[]) => hasTenantPermissionMock(...args),
}));

import {
  DEFAULT_ORDER_DASHBOARD_PAGE_SIZE,
  MAX_ORDER_DASHBOARD_PAGE_SIZE,
  listTenantOrdersForDashboard,
} from "./dashboard-service";

interface Row {
  id: string;
  status: string;
  fulfillment_type: string;
  customer_name: string | null;
  table_identifier: string | null;
  total_cents: number;
  currency: string;
  created_at: string;
}

function row(id: string): Row {
  return {
    id,
    status: "received",
    fulfillment_type: "pickup",
    customer_name: "Max",
    table_identifier: null,
    total_cents: 1500,
    currency: "EUR",
    created_at: "2026-08-17T10:00:00.000Z",
  };
}

function makeSupabase(options: {
  rows?: Row[] | null;
  error?: { message: string } | null;
  paymentStatuses?: Array<{ order_id: string; payment_status: string }> | null;
  rpcError?: { message: string } | null;
}) {
  const limitMock = vi.fn();
  const eqMock = vi.fn();
  const rpcMock = vi.fn(async () => ({
    data: options.paymentStatuses ?? null,
    error: options.rpcError ?? null,
  }));
  const builder = {
    select: () => builder,
    eq: (...args: unknown[]) => {
      eqMock(...args);
      return builder;
    },
    in: () => builder,
    order: () => builder,
    limit: (n: number) => {
      limitMock(n);
      return builder;
    },
    returns: async () => ({ data: options.rows ?? null, error: options.error ?? null }),
  };
  return { client: { from: () => builder, rpc: rpcMock } as never, limitMock, eqMock, rpcMock };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasTenantPermissionMock.mockResolvedValue(true);
});

describe("listTenantOrdersForDashboard", () => {
  it("scopes by tenant and maps rows with their payment status, defaulting to unpaid", async () => {
    const { client, eqMock, rpcMock, limitMock } = makeSupabase({
      rows: [row("a"), row("b")],
      paymentStatuses: [{ order_id: "a", payment_status: "paid" }],
    });

    const result = await listTenantOrdersForDashboard(client, { tenantId: "tenant-1" });

    expect(eqMock).toHaveBeenCalledWith("tenant_id", "tenant-1");
    expect(limitMock).toHaveBeenCalledWith(DEFAULT_ORDER_DASHBOARD_PAGE_SIZE + 1);
    expect(rpcMock).toHaveBeenCalledWith("get_tenant_order_payment_statuses", {
      p_tenant_id: "tenant-1",
      p_order_ids: ["a", "b"],
    });
    expect(result.hasMore).toBe(false);
    expect(result.orders.map((o) => [o.id, o.paymentStatus])).toEqual([
      ["a", "paid"],
      ["b", "unpaid"],
    ]);
    expect(result.orders[0]).toMatchObject({
      fulfillmentType: "pickup",
      customerName: "Max",
      totalCents: 1500,
    });
  });

  it("hides revenue figures without payments.read", async () => {
    hasTenantPermissionMock.mockResolvedValue(false);
    const { client } = makeSupabase({ rows: [row("a")], paymentStatuses: [] });
    const result = await listTenantOrdersForDashboard(client, { tenantId: "tenant-1" });
    expect(result.orders[0]!.totalCents).toBeNull();
  });

  it("clamps the page size to the hard maximum and detects hasMore", async () => {
    const { client, limitMock } = makeSupabase({
      rows: [row("a"), row("b"), row("c")],
      paymentStatuses: [],
    });
    const result = await listTenantOrdersForDashboard(client, { tenantId: "t", limit: 2 });
    expect(result.hasMore).toBe(true);
    expect(result.orders).toHaveLength(2);

    await listTenantOrdersForDashboard(client, { tenantId: "t", limit: 100000 });
    expect(limitMock).toHaveBeenLastCalledWith(MAX_ORDER_DASHBOARD_PAGE_SIZE + 1);

    await listTenantOrdersForDashboard(client, { tenantId: "t", limit: -5 });
    expect(limitMock).toHaveBeenLastCalledWith(2);
  });

  it("returns an empty result without the payment-status RPC when there are no orders", async () => {
    const { client, rpcMock } = makeSupabase({ rows: null });
    const result = await listTenantOrdersForDashboard(client, { tenantId: "t" });
    expect(result).toEqual({ orders: [], hasMore: false });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("propagates an orders query error", async () => {
    const { client } = makeSupabase({ error: { message: "boom" } });
    await expect(listTenantOrdersForDashboard(client, { tenantId: "t" })).rejects.toEqual({
      message: "boom",
    });
  });

  it("propagates a payment-status RPC error", async () => {
    const { client } = makeSupabase({ rows: [row("a")], rpcError: { message: "rpc down" } });
    await expect(listTenantOrdersForDashboard(client, { tenantId: "t" })).rejects.toEqual({
      message: "rpc down",
    });
  });
});
