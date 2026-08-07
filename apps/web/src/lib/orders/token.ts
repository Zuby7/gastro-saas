import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque guest order-access token -- 256 bits of randomness, base64url
 * encoded. Deliberately a *distinct* token from the guest cart token
 * (`apps/web/src/lib/cart/token.ts`): per
 * `docs/security/tenant-isolation.md` Layer 0, a guest order-status read
 * needs its own cryptographically random, single-purpose token, not a reuse
 * of the cart's identity token. Ticket #22 ("Bestellstatus-Seite für
 * Kunden") builds the actual guest-facing status page on top of this;
 * ticket #21 only mints the token at checkout and returns it to the caller
 * (never persisting the raw value, see `hashOrderAccessToken`).
 */
export function createOrderAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest -- the only form of the order access token that reaches Postgres. */
export function hashOrderAccessToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
