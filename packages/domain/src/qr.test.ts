import { describe, expect, it } from "vitest";
import { buildTenantQrUrl } from "./qr";

describe("buildTenantQrUrl", () => {
  it("builds a tenant-specific menu URL with optional table parameter", () => {
    expect(
      buildTenantQrUrl({
        baseUrl: "https://example.com",
        tenantSlug: "mario",
        table: "12",
      }),
    ).toBe("https://example.com/r/mario?table=12");
  });
});
