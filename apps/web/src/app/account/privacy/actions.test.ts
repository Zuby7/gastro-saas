import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
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

function retentionFormData(days = "90"): FormData {
  const fd = new FormData();
  fd.set("analyticsEventsRetentionDays", days);
  return fd;
}

function deletionFormData(reason = "GDPR request"): FormData {
  const fd = new FormData();
  fd.set("reason", reason);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  fromMock.mockImplementation(() =>
    membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } }),
  );
});

describe("saveRetentionSettingsAction", () => {
  it("rejects an out-of-range retention period before hitting the database", async () => {
    const { saveRetentionSettingsAction } = await import("./actions");
    const result = await saveRetentionSettingsAction({}, retentionFormData("5"));

    expect(result.error).toBeDefined();
    expect(result.fieldErrors?.analyticsEventsRetentionDays).toBeDefined();
    expect(fromMock).not.toHaveBeenCalledWith("privacy_retention_settings");
  });

  it("denies the save when the caller lacks tenant.settings.write", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "insufficient_privilege" } });

    const { saveRetentionSettingsAction } = await import("./actions");
    const result = await saveRetentionSettingsAction({}, retentionFormData());

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
  });

  it("upserts the retention period scoped to the caller's own tenant when authorized", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    let capturedUpsert: unknown;
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") {
        return membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } });
      }
      return {
        upsert: async (payload: unknown) => {
          capturedUpsert = payload;
          return { error: null };
        },
      };
    });

    const { saveRetentionSettingsAction } = await import("./actions");
    const result = await saveRetentionSettingsAction({}, retentionFormData("120"));

    expect(result.success).toBeDefined();
    expect(capturedUpsert).toMatchObject({
      tenant_id: "tenant-1",
      analytics_events_retention_days: 120,
    });
  });
});

describe("requestTenantDataDeletionAction", () => {
  it("denies the request when the caller lacks tenant.data.delete (not just tenant.settings.write)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "insufficient_privilege" } });

    const { requestTenantDataDeletionAction } = await import("./actions");
    const result = await requestTenantDataDeletionAction({}, deletionFormData());

    expect(result.error).toContain("Owner");
  });

  it("processes the deletion request scoped to the caller's own tenant when authorized", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "require_tenant_permission") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: "request-1", error: null });
    });

    const { requestTenantDataDeletionAction } = await import("./actions");
    const result = await requestTenantDataDeletionAction({}, deletionFormData("Bitte loeschen"));

    expect(result.success).toBeDefined();
    expect(rpcMock).toHaveBeenCalledWith("process_tenant_data_deletion_request", {
      p_tenant_id: "tenant-1",
      p_reason: "Bitte loeschen",
    });
  });

  it("surfaces a friendly error when the RPC itself fails (permission check passed)", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "require_tenant_permission") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    });

    const { requestTenantDataDeletionAction } = await import("./actions");
    const result = await requestTenantDataDeletionAction({}, deletionFormData());

    expect(result.error).toBeDefined();
    expect(result.success).toBeUndefined();
  });
});

describe("purgeExpiredAnalyticsEventsAction", () => {
  it("denies the purge when the caller lacks tenant.settings.write", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "insufficient_privilege" } });

    const { purgeExpiredAnalyticsEventsAction } = await import("./actions");
    const result = await purgeExpiredAnalyticsEventsAction({}, new FormData());

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
  });

  it("calls purge_expired_analytics_events scoped to the caller's own tenant when authorized", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "require_tenant_permission") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: 3, error: null });
    });

    const { purgeExpiredAnalyticsEventsAction } = await import("./actions");
    const result = await purgeExpiredAnalyticsEventsAction({}, new FormData());

    expect(result.success).toContain("3");
    expect(rpcMock).toHaveBeenCalledWith("purge_expired_analytics_events", {
      p_tenant_id: "tenant-1",
    });
  });

  it("surfaces a friendly error when the RPC itself fails (permission check passed)", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "require_tenant_permission") {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    });

    const { purgeExpiredAnalyticsEventsAction } = await import("./actions");
    const result = await purgeExpiredAnalyticsEventsAction({}, new FormData());

    expect(result.error).toBeDefined();
    expect(result.success).toBeUndefined();
  });
});
