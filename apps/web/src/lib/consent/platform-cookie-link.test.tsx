import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlatformCookieLink } from "./platform-cookie-link";

describe("PlatformCookieLink", () => {
  it("links to the cookie section of the platform Datenschutzerklärung", () => {
    render(<PlatformCookieLink />);
    expect(screen.getByRole("link", { name: "Cookie-Einstellungen" })).toHaveAttribute(
      "href",
      "/datenschutz#cookies",
    );
  });
});
