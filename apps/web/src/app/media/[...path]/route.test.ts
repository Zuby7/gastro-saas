import { describe, expect, it, vi } from "vitest";

const createSignedUrlMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("dish-media");
        return { createSignedUrl: createSignedUrlMock };
      },
    },
  }),
}));

describe("GET /media/[...path]", () => {
  it("redirects to a short-lived signed URL for a valid storage path", async () => {
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
});
