import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque guest cart identity token -- 256 bits of randomness, base64url
 * encoded. Mirrors `apps/web/src/lib/invitations/tokens.ts`'s convention:
 * the raw token lives only in an httpOnly cookie, never in the database.
 */
export function createCartToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest -- the only form of the cart token that reaches Postgres. */
export function hashCartToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
