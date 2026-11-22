import { describe, expect, it } from "vitest";
import { accountNoticeMessage } from "./account-notices";

describe("accountNoticeMessage", () => {
  it("maps known keys to fixed German text", () => {
    expect(accountNoticeMessage("tenant-slug-taken")).toContain("Web-Adresse");
    expect(accountNoticeMessage("tenant-create-failed")).toContain("Restaurant");
  });

  it("never echoes unknown, inherited or array values", () => {
    expect(accountNoticeMessage("<script>alert(1)</script>")).toBeNull();
    expect(accountNoticeMessage("constructor")).toBeNull();
    expect(accountNoticeMessage(["tenant-slug-taken"])).toBeNull();
    expect(accountNoticeMessage(undefined)).toBeNull();
  });
});
