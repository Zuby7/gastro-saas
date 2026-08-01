import { describe, expect, it } from "vitest";
import { LoginSchema, RegisterSchema } from "./schemas";

describe("RegisterSchema", () => {
  it("accepts a well-formed registration payload", () => {
    const result = RegisterSchema.safeParse({
      tenantName: "Trattoria Da Mario",
      tenantSlug: "trattoria-da-mario",
      email: "Owner@Example.com",
      password: "Sup3rSecurePassw0rd!",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Normalized: trimmed + lowercased.
      expect(result.data.email).toBe("owner@example.com");
    }
  });

  it("rejects a slug with uppercase letters or invalid characters", () => {
    expect(
      RegisterSchema.safeParse({
        tenantName: "Trattoria Da Mario",
        tenantSlug: "Trattoria_Da_Mario!",
        email: "owner@example.com",
        password: "Sup3rSecurePassw0rd!",
      }).success,
    ).toBe(false);
  });

  it("rejects a password shorter than 12 characters", () => {
    expect(
      RegisterSchema.safeParse({
        tenantName: "Trattoria Da Mario",
        tenantSlug: "trattoria-da-mario",
        email: "owner@example.com",
        password: "short1!",
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid email", () => {
    expect(
      RegisterSchema.safeParse({
        tenantName: "Trattoria Da Mario",
        tenantSlug: "trattoria-da-mario",
        email: "not-an-email",
        password: "Sup3rSecurePassw0rd!",
      }).success,
    ).toBe(false);
  });

  it("rejects an empty tenant name", () => {
    expect(
      RegisterSchema.safeParse({
        tenantName: "",
        tenantSlug: "trattoria-da-mario",
        email: "owner@example.com",
        password: "Sup3rSecurePassw0rd!",
      }).success,
    ).toBe(false);
  });
});

describe("LoginSchema", () => {
  it("accepts a well-formed login payload", () => {
    expect(
      LoginSchema.safeParse({ email: "owner@example.com", password: "anything" }).success,
    ).toBe(true);
  });

  it("rejects an invalid email", () => {
    expect(LoginSchema.safeParse({ email: "not-an-email", password: "anything" }).success).toBe(
      false,
    );
  });

  it("rejects an empty password", () => {
    expect(LoginSchema.safeParse({ email: "owner@example.com", password: "" }).success).toBe(false);
  });
});
