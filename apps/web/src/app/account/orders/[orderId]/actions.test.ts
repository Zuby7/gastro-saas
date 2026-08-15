import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const issueRefundForOrderMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
    rpc: rpcMock,
  }),
}));

vi.mock("@/lib/payments/refund-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/payments/refund-service")>(
    "@/lib/payments/refund-service",
  );
  return {
    ...actual,
    issueRefundForOrder: (...args: unknown[]) => issueRefundForOrderMock(...args),
  };
});

function membershipTable() {
  return {
    select: () => ({
      eq: () => ({
        limit: () => ({
          maybeSingle: async () => ({
            data: { tenant_id: "tenant-1", role: "owner" },
            error: null,
          }),
        }),
      }),
    }),
  };
}

function refundFormData(overrides: Partial<Record<string, string>> = {}): FormData {
  const fd = new FormData();
  fd.set("orderId", overrides.orderId ?? "11111111-1111-4111-8111-111111111111");
  fd.set("amountCents", overrides.amountCents ?? "500");
  fd.set("reason", overrides.reason ?? "Kunde unzufrieden");
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  fromMock.mockImplementation((table: string) => {
    if (table === "tenant_memberships") {
      return membershipTable();
    }
    throw new Error(`unexpected table: ${table}`);
  });
});

describe("issueRefundAction", () => {
  it("denies issuing a refund when the caller lacks payments.refund (permission-denied case)", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: { message: "insufficient_privilege" } };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const { issueRefundAction } = await import("./actions");
    const result = await issueRefundAction({}, refundFormData());

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(issueRefundForOrderMock).not.toHaveBeenCalled();
  });

  it("rejects invalid input (non-numeric amount, empty reason) before checking permissions", async () => {
    const { issueRefundAction } = await import("./actions");
    const result = await issueRefundAction(
      {},
      refundFormData({ amountCents: "not-a-number", reason: "" }),
    );

    expect(result.error).toBeDefined();
    expect(result.fieldErrors?.amountCents).toBeDefined();
    expect(result.fieldErrors?.reason).toBeDefined();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("issues a refund scoped to the caller's own tenant when authorized", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      throw new Error(`unexpected rpc: ${fn}`);
    });
    issueRefundForOrderMock.mockResolvedValue({
      refundId: "refund-1",
      stripeRefundId: "re_test_abc",
      amountCents: 500,
    });

    const { issueRefundAction } = await import("./actions");
    const result = await issueRefundAction({}, refundFormData());

    expect(result.success).toBeDefined();
    expect(issueRefundForOrderMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: "tenant-1",
        actorUserId: "user-1",
        amountCents: 500,
        reason: "Kunde unzufrieden",
      }),
    );
  });

  it("surfaces a clear error when the requested amount would exceed the remaining refundable amount", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      throw new Error(`unexpected rpc: ${fn}`);
    });
    const { RefundExceedsRemainingAmountError } = await import("@/lib/payments/refund-service");
    issueRefundForOrderMock.mockRejectedValue(new RefundExceedsRemainingAmountError());

    const { issueRefundAction } = await import("./actions");
    const result = await issueRefundAction({}, refundFormData({ amountCents: "999999" }));

    expect(result.error).toMatch(/übersteigt/);
  });
});
