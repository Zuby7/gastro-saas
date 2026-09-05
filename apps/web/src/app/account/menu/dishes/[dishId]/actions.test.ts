import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotonImage } from "@cf-wasm/photon";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const storageUploadMock = vi.fn();
const storageRemoveMock = vi.fn();
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
    storage: {
      from: () => ({
        upload: storageUploadMock,
        remove: storageRemoveMock,
        createSignedUrl: vi.fn(),
      }),
    },
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

function denyPermission() {
  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === "require_tenant_permission") {
      return { data: null, error: { message: "insufficient_privilege" } };
    }
    throw new Error(`unexpected rpc: ${fn}`);
  });
}

function allowPermission() {
  rpcMock.mockImplementation(async () => ({ data: null, error: null }));
}

// jsdom's File/Blob implementation doesn't provide `arrayBuffer()` (verified
// empirically against this repo's jsdom version) even though real Node/edge
// runtimes do -- this fake stands in only where the action actually reads
// the file's bytes.
function fakeFile(name: string, type: string, bytes: Uint8Array): File {
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.buffer,
  });
  return file;
}

/**
 * Ticket #72: `uploadDishImageAction` now decodes/re-encodes the upload via
 * `reEncodeDishImage`, so tests that need the action to reach the storage
 * upload step must pass real, decodable image bytes -- a zero-filled buffer
 * (as used pre-#72) is correctly rejected as an invalid image now.
 */
function makeValidJpegBytes(width = 4, height = 4): Uint8Array {
  const pixels = new Uint8Array(width * height * 4).fill(128);
  const image = new PhotonImage(pixels, width, height);
  return new Uint8Array(image.get_bytes_jpeg(90));
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  fromMock.mockImplementation((table: string) => {
    if (table === "tenant_memberships") return membershipTable();
    throw new Error(`unexpected table: ${table}`);
  });
});

describe("updateDishBasicsAction", () => {
  it("denies the update when the caller lacks menu.write", async () => {
    denyPermission();
    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("name", "Margherita");
    fd.set("description", "");
    fd.set("priceCents", "900");

    const { updateDishBasicsAction } = await import("./actions");
    const result = await updateDishBasicsAction({}, fd);

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(fromMock).not.toHaveBeenCalledWith("dishes");
  });
});

describe("createVariantAction", () => {
  it("inserts a variant scoped to the caller's own tenant when authorized", async () => {
    allowPermission();
    let insertedRow: Record<string, unknown> | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "dish_variants") {
        return {
          insert: async (row: Record<string, unknown>) => {
            insertedRow = row;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("name", "Groß");
    fd.set("priceCents", "1200");

    const { createVariantAction } = await import("./actions");
    const result = await createVariantAction({}, fd);

    expect(result.success).toBeDefined();
    expect(insertedRow).toMatchObject({
      tenant_id: "tenant-1",
      dish_id: "dish-1",
      price_cents: 1200,
    });
  });
});

describe("toggleAssignmentAction", () => {
  it("denies toggling an assignment when the caller lacks menu.write", async () => {
    denyPermission();
    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("itemId", "allergen-1");
    fd.set("entity", "allergen");
    fd.set("assign", "true");

    const { toggleAssignmentAction } = await import("./actions");
    const result = await toggleAssignmentAction({}, fd);

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
  });

  it("inserts into dish_allergen_assignments when assigning", async () => {
    allowPermission();
    let insertedRow: Record<string, unknown> | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "dish_allergen_assignments") {
        return {
          insert: async (row: Record<string, unknown>) => {
            insertedRow = row;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("itemId", "allergen-1");
    fd.set("entity", "allergen");
    fd.set("assign", "true");

    const { toggleAssignmentAction } = await import("./actions");
    const result = await toggleAssignmentAction({}, fd);

    expect(result.success).toBeDefined();
    expect(insertedRow).toMatchObject({
      tenant_id: "tenant-1",
      dish_id: "dish-1",
      allergen_id: "allergen-1",
    });
  });

  it("deletes from dish_additive_assignments scoped to the tenant when unassigning", async () => {
    allowPermission();
    const deleteEqCalls: [string, unknown][] = [];
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "dish_additive_assignments") {
        const builder = {
          delete: () => builder,
          eq: (column: string, value: unknown) => {
            deleteEqCalls.push([column, value]);
            return builder;
          },
          then: (resolve: (value: { error: null }) => unknown) => resolve({ error: null }),
        };
        return builder;
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("itemId", "additive-1");
    fd.set("entity", "additive");
    fd.set("assign", "false");

    const { toggleAssignmentAction } = await import("./actions");
    const result = await toggleAssignmentAction({}, fd);

    expect(result.success).toBeDefined();
    expect(deleteEqCalls).toEqual(
      expect.arrayContaining([
        ["dish_id", "dish-1"],
        ["additive_id", "additive-1"],
        ["tenant_id", "tenant-1"],
      ]),
    );
  });
});

describe("uploadDishImageAction", () => {
  it("rejects a disallowed file type before touching storage", async () => {
    allowPermission();
    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("altText", "Ein Teller Pasta");
    fd.set("file", new File(["not-an-image"], "menu.pdf", { type: "application/pdf" }));

    const { uploadDishImageAction } = await import("./actions");
    const result = await uploadDishImageAction({}, fd);

    expect(result.error).toMatch(/JPEG|PNG|WebP/);
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it("rejects a file larger than 5MB before touching storage", async () => {
    allowPermission();
    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("altText", "Ein Teller Pasta");
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    fd.set("file", new File([oversized], "big.jpg", { type: "image/jpeg" }));

    const { uploadDishImageAction } = await import("./actions");
    const result = await uploadDishImageAction({}, fd);

    expect(result.error).toMatch(/5 MB/);
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it("requires an alt text", async () => {
    allowPermission();
    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("altText", "");
    fd.set("file", new File(["abc"], "dish.jpg", { type: "image/jpeg" }));

    const { uploadDishImageAction } = await import("./actions");
    const result = await uploadDishImageAction({}, fd);

    expect(result.error).toMatch(/Alt-Text/);
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it("uploads to a tenant-scoped path and attaches the media asset when valid", async () => {
    allowPermission();
    storageUploadMock.mockResolvedValue({ error: null });
    let uploadedPath = "";
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "media_assets") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: "media-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "dishes") {
        return {
          update: () => ({
            eq: () => ({
              eq: () => ({
                select: async () => ({ data: [{ id: "dish-1" }], error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "audit_logs") {
        return {
          insert: async () => ({ error: null }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });
    storageUploadMock.mockImplementation(async (path: string) => {
      uploadedPath = path;
      return { error: null };
    });

    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("altText", "Ein Teller Pasta");
    fd.set("file", fakeFile("dish.jpg", "image/jpeg", makeValidJpegBytes()));

    const { uploadDishImageAction } = await import("./actions");
    const result = await uploadDishImageAction({}, fd);

    expect(result.success).toBeDefined();
    expect(uploadedPath.startsWith("tenant-1/")).toBe(true);
    // Ticket #72: the action always stores the re-encoded JPEG output, not
    // the original upload bytes/content-type.
    expect(uploadedPath.endsWith(".jpg")).toBe(true);
    expect(storageUploadMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer),
      expect.objectContaining({ contentType: "image/jpeg" }),
    );
  });

  it("rejects a file that declares an allowed MIME type but isn't a decodable image", async () => {
    allowPermission();
    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("altText", "Ein Teller Pasta");
    const bogusBytes = new TextEncoder().encode("this is not a real image".repeat(10));
    fd.set("file", fakeFile("fake.jpg", "image/jpeg", bogusBytes));

    const { uploadDishImageAction } = await import("./actions");
    const result = await uploadDishImageAction({}, fd);

    expect(result.error).toMatch(/gültiges Bild/);
    expect(storageUploadMock).not.toHaveBeenCalled();
  });
});

describe("setDishAvailabilityAction", () => {
  it("denies the toggle when the caller lacks menu.availability.manage", async () => {
    denyPermission();
    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("isAvailable", "false");
    fd.set("availableAgainAt", "");

    const { setDishAvailabilityAction } = await import("./actions");
    const result = await setDishAvailabilityAction({}, fd);

    expect(result.error).toContain("nicht die erforderliche Berechtigung");
    expect(rpcMock).not.toHaveBeenCalledWith("set_dish_availability", expect.anything());
  });

  it("calls set_dish_availability with the parsed availability fields and records an audit event", async () => {
    let auditRow: Record<string, unknown> | undefined;
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      if (table === "audit_logs") {
        return {
          insert: async (row: Record<string, unknown>) => {
            auditRow = row;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });
    rpcMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "set_dish_availability") {
        expect(args).toMatchObject({
          p_dish_id: "dish-1",
          p_tenant_id: "tenant-1",
          p_is_available: false,
          p_available_again_at: null,
        });
        return { data: null, error: null };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("isAvailable", "false");
    fd.set("availableAgainAt", "");

    const { setDishAvailabilityAction } = await import("./actions");
    const result = await setDishAvailabilityAction({}, fd);

    expect(result.success).toBeDefined();
    expect(auditRow).toMatchObject({
      tenant_id: "tenant-1",
      action: "dish.marked_sold_out",
      target_type: "dish",
      target_id: "dish-1",
    });
  });

  it("returns an error when set_dish_availability fails", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "tenant_memberships") return membershipTable();
      throw new Error(`unexpected table: ${table}`);
    });
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "require_tenant_permission") return { data: null, error: null };
      if (fn === "set_dish_availability") return { data: null, error: { message: "not found" } };
      throw new Error(`unexpected rpc: ${fn}`);
    });

    const fd = new FormData();
    fd.set("dishId", "dish-1");
    fd.set("isAvailable", "true");
    fd.set("availableAgainAt", "");

    const { setDishAvailabilityAction } = await import("./actions");
    const result = await setDishAvailabilityAction({}, fd);

    expect(result.error).toBeDefined();
  });
});
