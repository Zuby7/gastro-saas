import { createHash, randomBytes } from "node:crypto";

/**
 * Shared primitives for every opaque bearer token in this app (guest cart
 * identity, guest order access, menu-view analytics session, tenant
 * invitations). One implementation instead of four identical copies, so the
 * entropy and hashing convention cannot drift apart between them.
 *
 * Convention: the raw token lives only where the bearer needs it (an httpOnly
 * cookie or a one-time link) and never reaches the database. Postgres only
 * ever stores and compares the SHA-256 hex digest. Tokens stay
 * single-purpose: each caller mints its own token, a token is never reused
 * across purposes (docs/security/tenant-isolation.md Layer 0).
 */

/** 256 bits of randomness, base64url encoded (43 URL-safe characters). */
export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest, the only form of an opaque token that reaches Postgres. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
