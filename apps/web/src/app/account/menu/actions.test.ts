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

function categoryFormData(name = "Pizza"): FormData {
  const fd = new FormData();
  fd.set("name", name);
  return fd;
}

function dishFormData(overrides: Partial<Record<string, string>> = {}): FormData {
  const fd = new FormData();
  fd.set("categoryId", overrides.categoryId ?? "11111111-1111-4111-8111-111111111111");
  fd.set("name", overrides.name ?? "Margherita");
  fd.set("description", overrides.description ?? "");
  fd.set("priceEuro", overrides.priceEuro ?? "9,00");
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

describe("createCategoryAction", () => {
  it("denies creating a category when the caller lacks menu.write", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: { message: "insufficient_privilege" } };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const { createCategoryAction } = await import("./actions");
    const result = await createCategoryAction({}, categoryFormData());

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(fromMock).not.toHaveBeenCalledWith("categories");
  });

  it("creates a category scoped to the caller's own tenant when authorized", async () => {
    rpcMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "create_initial_draft_menu_version") {
        expect(args.p_tenant_id).toBe("tenant-1");
        return { data: "draft-1", error: null };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    let insertedRow: Record<string, unknown> | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "categories") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              }),
            }),
          }),
          insert: async (row: Record<string, unknown>) => {
            insertedRow = row;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { createCategoryAction } = await import("./actions");
    const result = await createCategoryAction({}, categoryFormData("Pizza"));

    expect(result.success).toBeDefined();
    expect(insertedRow).toMatchObject({
      tenant_id: "tenant-1",
      menu_version_id: "draft-1",
      name: "Pizza",
    });
  });
});

describe("createDishAction", () => {
  it("denies creating a dish when the caller lacks menu.write", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") {
        return { data: null, error: { message: "insufficient_privilege" } };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const { createDishAction } = await import("./actions");
    const result = await createDishAction({}, dishFormData());

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(fromMock).not.toHaveBeenCalledWith("dishes");
  });
});

describe("createDishAction euro price", () => {
  const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";

  function allowAndCapture() {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "create_initial_draft_menu_version") return { data: "draft-1", error: null };
      throw new Error(`unexpected rpc: ${fn}`);
    });
    const captured: { row?: Record<string, unknown> } = {};
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "dishes") {
        return {
          insert: (row: Record<string, unknown>) => {
            captured.row = row;
            return {
              select: () => ({ single: async () => ({ data: { id: "d1" }, error: null }) }),
            };
          },
        };
      }
      if (table === "menu_admin_audit_events" || table === "audit_events") {
        return { insert: async () => ({ error: null }) };
      }
      return { insert: async () => ({ error: null }) };
    });
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
    return captured;
  }

  it.each([
    ["12,50", 1250],
    ["12.5", 1250],
    ["12", 1200],
    ["", null],
  ])("stores euro input %j as %s cents", async (input, cents) => {
    const captured = allowAndCapture();
    const { createDishAction } = await import("./actions");
    const result = await createDishAction(
      {},
      dishFormData({ categoryId: CATEGORY_ID, priceEuro: input }),
    );

    expect(result.success).toBeDefined();
    expect(captured.row).toMatchObject({ price_cents: cents });
  });

  it("returns a priceEuro field error for too many decimals and does not insert", async () => {
    const captured = allowAndCapture();
    const { createDishAction } = await import("./actions");
    const result = await createDishAction(
      {},
      dishFormData({ categoryId: CATEGORY_ID, priceEuro: "12,505" }),
    );

    expect(result.fieldErrors?.priceEuro).toBeDefined();
    expect(captured.row).toBeUndefined();
  });
});

describe("moveCategoryAction", () => {
  it("ignores archived categories when picking the neighbour", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "swap_category_sort_order") return { data: null, error: null };
      throw new Error(`unexpected rpc: ${fn}`);
    });
    const isMock = vi.fn();
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "categories") {
        return {
          select: () => ({
            eq: (firstColumn: string) => ({
              eq: () =>
                firstColumn === "id"
                  ? {
                      maybeSingle: async () => ({
                        data: { id: "c2", menu_version_id: "v1", sort_order: 2 },
                        error: null,
                      }),
                    }
                  : {
                      is: (...args: unknown[]) => {
                        isMock(...args);
                        return {
                          order: () => ({
                            returns: async () => ({
                              // The query already excludes the archived row, so
                              // the previous visible sibling is c1.
                              data: [
                                { id: "c1", sort_order: 1 },
                                { id: "c2", sort_order: 2 },
                              ],
                            }),
                          }),
                        };
                      },
                    },
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const fd = new FormData();
    fd.set("categoryId", "c2");
    fd.set("direction", "up");
    const { moveCategoryAction } = await import("./actions");
    const result = await moveCategoryAction({}, fd);

    expect(isMock).toHaveBeenCalledWith("archived_at", null);
    expect(rpcMock).toHaveBeenCalledWith("swap_category_sort_order", {
      p_category_id: "c2",
      p_neighbor_id: "c1",
    });
    expect(result.success).toBeDefined();
  });
});

describe("publishAction", () => {
  it("denies publishing when the caller has menu.write but not menu.publish", async () => {
    rpcMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "require_tenant_permission") {
        expect(args.p_permission_key).toBe("menu.publish");
        return { data: null, error: { message: "insufficient_privilege" } };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const fd = new FormData();
    fd.set("menuVersionId", "draft-1");

    const { publishAction } = await import("./actions");
    const result = await publishAction({}, fd);

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(rpcMock).not.toHaveBeenCalledWith("publish_menu_version", expect.anything());
  });

  it("publishes when the caller has menu.publish", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "publish_menu_version") return { data: null, error: null };
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const fd = new FormData();
    fd.set("menuVersionId", "draft-1");

    const { publishAction } = await import("./actions");
    const result = await publishAction({}, fd);

    expect(result.success).toBeDefined();
  });

  it("reports a clear message when the database rejects publishing due to blockers", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "publish_menu_version") {
        return { data: null, error: { message: "Menu has blockers and cannot be published" } };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const fd = new FormData();
    fd.set("menuVersionId", "draft-1");

    const { publishAction } = await import("./actions");
    const result = await publishAction({}, fd);

    expect(result.error).toMatch(/Blocker/);
  });
});

describe("runPublishChecksAction", () => {
  it("returns blocker/warning rows from run_menu_publish_checks", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "run_menu_publish_checks") {
        return {
          data: [{ severity: "blocker", code: "no-purchasable-dish", message: "no dish" }],
          error: null,
        };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const fd = new FormData();
    fd.set("menuVersionId", "draft-1");

    const { runPublishChecksAction } = await import("./actions");
    const result = await runPublishChecksAction({}, fd);

    expect(result.checks).toHaveLength(1);
    expect(result.checks?.[0]?.severity).toBe("blocker");
  });
});
