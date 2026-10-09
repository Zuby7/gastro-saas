import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInvitationToken, hashInvitationToken } from "./tokens";

describe("invitation token", () => {
  it("generates URL-safe, 256-bit base64url tokens", () => {
    const token = createInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("generates unique tokens", () => {
    expect(new Set(Array.from({ length: 200 }, () => createInvitationToken())).size).toBe(200);
  });

  it("hashes deterministically to a SHA-256 hex digest", () => {
    const hash = hashInvitationToken("abc");
    expect(hash).toBe(hashInvitationToken("abc"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash("sha256").update("abc", "utf8").digest("hex"));
  });

  it("hashes different inputs differently", () => {
    expect(hashInvitationToken("token-a")).not.toBe(hashInvitationToken("token-b"));
  });

  it("never equals the raw token", () => {
    const token = createInvitationToken();
    expect(hashInvitationToken(token)).not.toBe(token);
  });
});
