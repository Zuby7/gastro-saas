import { describe, expect, it, vi, beforeEach } from "vitest";

const createSignedUrlMock = vi.fn();
const maybeSingleMock = vi.fn();

// Chainable query builder mock mirroring the subset of the supabase-js
// PostgREST query builder used by the route (`.from().select().eq().is().eq().maybeSingle()`).
function createQueryBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.maybeSingle = maybeSingleMock;
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("media_assets");
      return createQueryBuilder();
    },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("dish-media");
        return { createSignedUrl: createSignedUrlMock };
      },
    },
  }),
}));

describe("GET /media/[...path]", () => {
  beforeEach(() => {
    createSignedUrlMock.mockReset();
    maybeSingleMock.mockReset();
  });

  it("redirects to a short-lived signed URL for a published dish's media", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: "asset-1", dishes: { id: "dish-1", archived_at: null, menu_versions: { status: "published" } } },
      error: null,
    });
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/signed/dish.jpg?token=abc" },
      error: null,
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/media/tenant-1/dishes/pizza.jpg"), {
      params: Promise.resolve({ path: ["tenant-1", "dishes", "pizza.jpg"] }),
    });

    expect(createSignedUrlMock).toHaveBeenCalledWith("tenant-1/dishes/pizza.jpg", 60);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://storage.example.test/signed/dish.jpg?token=abc",
    );
  });

  it("returns 404 when the storage object does not exist rather than leaking the Storage error", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: "asset-1", dishes: { id: "dish-1", archived_at: null, menu_versions: { status: "published" } } },
      error: null,
    });
    createSignedUrlMock.mockResolvedValue({
      data: null,
      error: { message: "Object not found" },
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/media/tenant-1/dishes/missing.jpg"), {
      params: Promise.resolve({ path: ["tenant-1", "dishes", "missing.jpg"] }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 for media belonging to a draft-only/archived dish (never published, or archived)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/media/tenant-1/dishes/draft.jpg"), {
      params: Promise.resolve({ path: ["tenant-1", "dishes", "draft.jpg"] }),
    });

    expect(response.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a storage path belonging to another tenant's asset (no matching media_assets row)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/media/tenant-2/dishes/other-tenant.jpg"), {
      params: Promise.resolve({ path: ["tenant-2", "dishes", "other-tenant.jpg"] }),
    });

    expect(response.status).toBe(404);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a path containing a '..' segment without ever querying Storage", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/media/tenant-1/../tenant-2/secret.jpg"), {
      params: Promise.resolve({ path: ["tenant-1", "..", "tenant-2", "secret.jpg"] }),
    });

    expect(response.status).toBe(404);
    expect(maybeSingleMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });
});
