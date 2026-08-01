import { describe, expect, it } from "vitest";
import { assertSafeAuditMetadata, UnsafeAuditMetadataError } from "./secret-detection";

describe("assertSafeAuditMetadata", () => {
  it("accepts safe, non-secret metadata", () => {
    expect(() =>
      assertSafeAuditMetadata({
        dishName: "Margherita",
        previousStatus: "draft",
        newStatus: "published",
        count: 3,
        nested: { reason: "menu update" },
      }),
    ).not.toThrow();
  });

  it("accepts null, undefined, and empty objects", () => {
    expect(() => assertSafeAuditMetadata(null)).not.toThrow();
    expect(() => assertSafeAuditMetadata(undefined)).not.toThrow();
    expect(() => assertSafeAuditMetadata({})).not.toThrow();
  });

  it("rejects a secret-shaped key name", () => {
    expect(() => assertSafeAuditMetadata({ password: "hunter2" })).toThrow(
      UnsafeAuditMetadataError,
    );
    expect(() => assertSafeAuditMetadata({ apiKey: "whatever" })).toThrow(UnsafeAuditMetadataError);
    expect(() => assertSafeAuditMetadata({ stripe_client_secret: "x" })).toThrow(
      UnsafeAuditMetadataError,
    );
  });

  it("rejects a JWT-shaped string value", () => {
    // Fake, non-functional JWT shape (no real signing key, not a real
    // token) -- exists purely so the detector has a JWT-shaped value to
    // reject. gitleaks:allow
    const fakeJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.4gI-VYVN0Cfy8i8XKgpFvGZQ8wF3xKW8vSY9v0DDJhU"; // gitleaks:allow
    expect(() => assertSafeAuditMetadata({ note: fakeJwt })).toThrow(UnsafeAuditMetadataError);
  });

  it("rejects an API-key-shaped string value", () => {
    // Fake Stripe-test-key-shaped string, not a real key.
    const fakeApiKey = "sk_test_51H8xyzabcdefghijklmno"; // gitleaks:allow
    expect(() => assertSafeAuditMetadata({ note: fakeApiKey })).toThrow(UnsafeAuditMetadataError);
  });

  it("rejects a card-number-shaped string value", () => {
    // Well-known Stripe test card numbers (never real cards).
    const fakeCardNumberSpaced = "4242 4242 4242 4242"; // gitleaks:allow
    const fakeCardNumberPlain = "4242424242424242"; // gitleaks:allow
    expect(() => assertSafeAuditMetadata({ note: fakeCardNumberSpaced })).toThrow(
      UnsafeAuditMetadataError,
    );
    expect(() => assertSafeAuditMetadata({ note: fakeCardNumberPlain })).toThrow(
      UnsafeAuditMetadataError,
    );
  });

  it("rejects secrets nested inside arrays/objects", () => {
    expect(() => assertSafeAuditMetadata({ items: [{ token: "abc123" }] })).toThrow(
      UnsafeAuditMetadataError,
    );
  });

  it("does not flag an ordinary numeric id as a card number", () => {
    expect(() => assertSafeAuditMetadata({ orderNumber: "12345" })).not.toThrow();
  });
});
