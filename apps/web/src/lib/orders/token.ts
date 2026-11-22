import { createOpaqueToken, sha256Hex } from "@/lib/security/opaque-token";

/**
 * Opaque guest order-access token. Deliberately a *distinct* token from the
 * guest cart token: per `docs/security/tenant-isolation.md` Layer 0, a guest
 * order-status read needs its own cryptographically random, single-purpose
 * token, not a reuse of the cart's identity token. The primitives themselves
 * live in `@/lib/security/opaque-token` (shared with cart, menu-view and
 * invitation tokens); this module only keeps the order-specific names.
 */
export function createOrderAccessToken(): string {
  return createOpaqueToken();
}

/** SHA-256 hex digest, the only form of the order access token that reaches Postgres. */
export function hashOrderAccessToken(token: string): string {
  return sha256Hex(token);
}
