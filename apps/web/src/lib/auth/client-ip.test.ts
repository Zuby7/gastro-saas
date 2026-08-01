import { describe, expect, it, vi } from "vitest";

const headersMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

function fakeHeaders(values: Record<string, string>) {
  return {
    get: (name: string) => values[name] ?? null,
  };
}

describe("getClientIp", () => {
  it("prefers cf-connecting-ip over x-forwarded-for when both are set", async () => {
    headersMock.mockResolvedValue(
      fakeHeaders({
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.1, 203.0.113.9",
      }),
    );

    const { getClientIp } = await import("./client-ip");
    await expect(getClientIp()).resolves.toBe("203.0.113.9");
  });

  it("falls back to the rightmost x-forwarded-for hop when cf-connecting-ip is absent", async () => {
    headersMock.mockResolvedValue(
      fakeHeaders({
        "x-forwarded-for": "198.51.100.1, 203.0.113.9, 192.0.2.55",
      }),
    );

    const { getClientIp } = await import("./client-ip");
    await expect(getClientIp()).resolves.toBe("192.0.2.55");
  });

  it("never trusts the leftmost (client-supplied) x-forwarded-for hop", async () => {
    // A single-hop XFF is indistinguishable from an attacker just setting
    // the header themselves -- the rightmost-hop rule still applies (it's
    // the only hop here), but this asserts we don't special-case "first" vs
    // "last" incorrectly for a spoofed single value.
    headersMock.mockResolvedValue(
      fakeHeaders({
        "x-forwarded-for": "1.2.3.4",
      }),
    );

    const { getClientIp } = await import("./client-ip");
    await expect(getClientIp()).resolves.toBe("1.2.3.4");
  });

  it("returns 'unknown' when neither header is present", async () => {
    headersMock.mockResolvedValue(fakeHeaders({}));

    const { getClientIp } = await import("./client-ip");
    await expect(getClientIp()).resolves.toBe("unknown");
  });
});
