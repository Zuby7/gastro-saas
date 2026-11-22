import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOpaqueToken, sha256Hex } from "./opaque-token";

describe("opaque token", () => {
  it("generates URL-safe, 256-bit base64url tokens", () => {
    const token = createOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("generates unique tokens", () => {
    expect(new Set(Array.from({ length: 200 }, () => createOpaqueToken())).size).toBe(200);
  });

  it("hashes deterministically to a SHA-256 hex digest", () => {
    const hash = sha256Hex("abc");
    expect(hash).toBe(sha256Hex("abc"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update("abc", "utf8").digest("hex"));
  });

  it("hashes different inputs differently", () => {
    expect(sha256Hex("token-a")).not.toBe(sha256Hex("token-b"));
  });

  it("never equals the raw token", () => {
    const token = createOpaqueToken();
    expect(sha256Hex(token)).not.toBe(token);
  });
});
