import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ loginAction: vi.fn() }));

import LoginPage from "./page";

describe("LoginPage cookie link (#163)", () => {
  it("links to the cookie section of the Datenschutzerklärung", () => {
    render(<LoginPage />);
    expect(screen.getByRole("link", { name: "Cookie-Hinweise" })).toHaveAttribute(
      "href",
      "/datenschutz#cookies",
    );
  });
});
