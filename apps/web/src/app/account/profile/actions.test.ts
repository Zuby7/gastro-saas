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

function upsertBuilder(result: { error: unknown }) {
  return {
    upsert: async () => result,
  };
}

function profileFormData(overrides: Partial<Record<string, string>> = {}): FormData {
  const fd = new FormData();
  fd.set("displayName", overrides.displayName ?? "Mario's Pizzeria");
  fd.set("description", overrides.description ?? "");
  fd.set("contactEmail", overrides.contactEmail ?? "");
  fd.set("phone", overrides.phone ?? "");
  fd.set("timezone", overrides.timezone ?? "Europe/Berlin");
  fd.set("brandColor", overrides.brandColor ?? "#166534");
  fd.set("legalImprintText", overrides.legalImprintText ?? "");
  fd.set("legalPrivacyText", overrides.legalPrivacyText ?? "");
  return fd;
}

function openingHoursFormData(): FormData {
  const fd = new FormData();
  for (let weekday = 0; weekday < 7; weekday += 1) {
    if (weekday === 0) {
      fd.set(`closed-${weekday}`, "on");
    } else {
      fd.set(`opens-${weekday}`, "09:00");
      fd.set(`closes-${weekday}`, "17:00");
    }
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  fromMock.mockImplementation(() =>
    membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } }),
  );
});

describe("saveProfileAction", () => {
  it("rejects when a required field is missing", async () => {
    const { saveProfileAction } = await import("./actions");
    const result = await saveProfileAction({}, profileFormData({ displayName: "" }));

    expect(result.error).toBeDefined();
    expect(result.fieldErrors?.displayName).toBeDefined();
    expect(fromMock).not.toHaveBeenCalledWith("restaurant_profiles");
  });

  it("denies the save when the caller lacks tenant.settings.write", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "insufficient_privilege" } });

    const { saveProfileAction } = await import("./actions");
    const result = await saveProfileAction({}, profileFormData());

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
  });

  it("upserts the profile scoped to the caller's own tenant when authorized", async () => {
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

    const { saveProfileAction } = await import("./actions");
    const result = await saveProfileAction({}, profileFormData());

    expect(result.success).toBeDefined();
    expect(capturedUpsert).toMatchObject({
      tenant_id: "tenant-1",
      display_name: "Mario's Pizzeria",
    });
  });

  it("saves the Impressum/Datenschutz free-text fields scoped to the caller's own tenant", async () => {
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

    const { saveProfileAction } = await import("./actions");
    const result = await saveProfileAction(
      {},
      profileFormData({
        legalImprintText: "Musterfirma GmbH, Musterstraße 1",
        legalPrivacyText: "Wir verarbeiten Ihre Daten gemäß DSGVO.",
      }),
    );

    expect(result.success).toBeDefined();
    expect(capturedUpsert).toMatchObject({
      tenant_id: "tenant-1",
      legal_imprint_text: "Musterfirma GmbH, Musterstraße 1",
      legal_privacy_text: "Wir verarbeiten Ihre Daten gemäß DSGVO.",
    });
  });
});

describe("saveOpeningHoursAction", () => {
  it("rejects contradictory hours before hitting the database", async () => {
    const fd = new FormData();
    fd.set("opens-1", "18:00");
    fd.set("closes-1", "12:00");
    for (let weekday = 0; weekday < 7; weekday += 1) {
      if (weekday === 1) continue;
      fd.set(`closed-${weekday}`, "on");
    }

    const { saveOpeningHoursAction } = await import("./actions");
    const result = await saveOpeningHoursAction({}, fd);

    expect(result.error).toBeDefined();
    expect(result.fieldErrors?.["closesAt-1"]).toBeDefined();
    expect(fromMock).not.toHaveBeenCalledWith("opening_hours");
  });

  it("denies the save when the caller lacks tenant.settings.write", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "insufficient_privilege" } });

    const { saveOpeningHoursAction } = await import("./actions");
    const result = await saveOpeningHoursAction({}, openingHoursFormData());

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
  });

  it("surfaces a friendly message when the database rejects contradictory hours", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") {
        return membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } });
      }
      return upsertBuilder({ error: { message: "opening_hours_check violated", code: "23514" } });
    });

    const { saveOpeningHoursAction } = await import("./actions");
    const result = await saveOpeningHoursAction({}, openingHoursFormData());

    expect(result.error).toMatch(/Widersprüchliche Öffnungszeiten/);
  });

  it("saves opening hours scoped to the caller's own tenant when authorized", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    let capturedPayload: unknown;
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") {
        return membershipQueryBuilder({ data: { tenant_id: "tenant-1", role: "owner" } });
      }
      return {
        upsert: async (payload: unknown) => {
          capturedPayload = payload;
          return { error: null };
        },
      };
    });

    const { saveOpeningHoursAction } = await import("./actions");
    const result = await saveOpeningHoursAction({}, openingHoursFormData());

    expect(result.success).toBeDefined();
    expect(Array.isArray(capturedPayload)).toBe(true);
    expect(capturedPayload as unknown[]).toHaveLength(7);
    expect(
      (capturedPayload as { tenant_id: string }[]).every((row) => row.tenant_id === "tenant-1"),
    ).toBe(true);
  });
});
