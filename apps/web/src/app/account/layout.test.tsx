import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/account" }));

import AccountLayout from "./layout";

describe("AccountLayout cookie link (#163)", () => {
  it("renders the cookie link in the footer and keeps the children", () => {
    render(
      <AccountLayout>
        <p>inhalt</p>
      </AccountLayout>,
    );
    expect(screen.getByText("inhalt")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cookie-Hinweise" })).toHaveAttribute(
      "href",
      "/datenschutz#cookies",
    );
  });
});
