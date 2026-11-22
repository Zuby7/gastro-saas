import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUserMock = vi.fn();
const membershipMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => ({ maybeSingle: membershipMock }),
        }),
      }),
    }),
  }),
}));

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/qr?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
  membershipMock.mockResolvedValue({ data: { tenants: { slug: "mario" } }, error: null });
});

describe("GET /api/qr", () => {
  it("returns 401 for an unauthenticated request", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    const { GET } = await import("./route");
    expect((await GET(request("slug=mario"))).status).toBe(401);
  });

  it("returns 403 when the slug is not the caller's own tenant", async () => {
    const { GET } = await import("./route");
    expect((await GET(request("slug=luigi"))).status).toBe(403);
  });

  it("returns an SVG for a valid table label", async () => {
    const { GET } = await import("./route");
    const response = await GET(request(`slug=mario&table=${encodeURIComponent("Terrasse 12-a")}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  });

  it("still works without a table parameter", async () => {
    const { GET } = await import("./route");
    expect((await GET(request("slug=mario&pickup=1"))).status).toBe(200);
  });

  // Issue #204 (audit 2026-11).
  it.each([
    ["longer than 32 characters", "a".repeat(33)],
    ["containing markup", "<script>alert(1)</script>"],
    ["containing URL syntax", "1&x=https://evil.example"],
    ["containing a line break", "12\n13"],
  ])("returns 400 for a table label %s, before any membership lookup", async (_name, table) => {
    const { GET } = await import("./route");
    const response = await GET(request(`slug=mario&table=${encodeURIComponent(table)}`));

    expect(response.status).toBe(400);
    expect(membershipMock).not.toHaveBeenCalled();
  });

  it("accepts a table label of exactly 32 characters", async () => {
    const { GET } = await import("./route");
    const response = await GET(request(`slug=mario&table=${"a".repeat(32)}`));
    expect(response.status).toBe(200);
  });
});
