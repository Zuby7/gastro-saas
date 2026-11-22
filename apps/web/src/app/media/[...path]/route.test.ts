import { Blob } from "node:buffer";
import { describe, expect, it, vi, beforeEach } from "vitest";

const downloadMock = vi.fn();
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
        return { download: downloadMock };
      },
    },
  }),
}));

describe("GET /media/[...path]", () => {
  beforeEach(() => {
    downloadMock.mockReset();
    maybeSingleMock.mockReset();
  });

  const publishedAsset = {
    data: {
      id: "asset-1",
      dishes: { id: "dish-1", archived_at: null, menu_versions: { status: "published" } },
    },
    error: null,
  };

  it("streams the bytes with content type, nosniff, cache headers and an ETag", async () => {
    maybeSingleMock.mockResolvedValue(publishedAsset);
    downloadMock.mockResolvedValue({
      data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
      error: null,
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/media/tenant-1/dishes/pizza.jpg"), {
      params: Promise.resolve({ path: ["tenant-1", "dishes", "pizza.jpg"] }),
    });

    expect(downloadMock).toHaveBeenCalledWith("tenant-1/dishes/pizza.jpg");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=86400, stale-while-revalidate=86400",
    );
    expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{32}"$/);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("answers a matching If-None-Match with 304 without reading Storage", async () => {
    maybeSingleMock.mockResolvedValue(publishedAsset);
    downloadMock.mockResolvedValue({
      data: new Blob([new Uint8Array([1])], { type: "image/jpeg" }),
      error: null,
    });
    const { GET } = await import("./route");
    const url = "http://localhost/media/tenant-1/dishes/pizza.jpg";
    const routeParams = () => ({
      params: Promise.resolve({ path: ["tenant-1", "dishes", "pizza.jpg"] }),
    });
    const first = await GET(new Request(url), routeParams());
    const etag = first.headers.get("etag")!;
    downloadMock.mockClear();

    const second = await GET(
      new Request(url, { headers: { "if-none-match": etag } }),
      routeParams(),
    );

    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("does not answer 304 for an unauthorized path even with a matching If-None-Match", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/media/tenant-1/dishes/draft.jpg", {
        headers: { "if-none-match": "*" },
      }),
      { params: Promise.resolve({ path: ["tenant-1", "dishes", "draft.jpg"] }) },
    );
    expect(response.status).toBe(404);
  });

  it("returns 404 when the storage object does not exist rather than leaking the Storage error", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: "asset-1",
        dishes: { id: "dish-1", archived_at: null, menu_versions: { status: "published" } },
      },
      error: null,
    });
    downloadMock.mockResolvedValue({
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
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a storage path belonging to another tenant's asset (no matching media_assets row)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/media/tenant-2/dishes/other-tenant.jpg"),
      {
        params: Promise.resolve({ path: ["tenant-2", "dishes", "other-tenant.jpg"] }),
      },
    );

    expect(response.status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a path containing a '..' segment without ever querying Storage", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/media/tenant-1/../tenant-2/secret.jpg"),
      {
        params: Promise.resolve({ path: ["tenant-1", "..", "tenant-2", "secret.jpg"] }),
      },
    );

    expect(response.status).toBe(404);
    expect(maybeSingleMock).not.toHaveBeenCalled();
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
