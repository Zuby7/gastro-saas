import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CookieTable } from "./cookie-table";
import { NECESSARY_COOKIES } from "./inventory";

describe("CookieTable", () => {
  it("makes the horizontally scrollable wrapper keyboard-focusable and labelled (issue #166)", () => {
    render(<CookieTable cookies={NECESSARY_COOKIES} caption="Notwendige Cookies" />);

    const region = screen.getByRole("region", { name: "Notwendige Cookies" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-x-auto");
    expect(region.className).toContain("focus-visible:outline");
  });
});
