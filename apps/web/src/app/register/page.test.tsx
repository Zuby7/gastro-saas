import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ registerAction: vi.fn() }));

import RegisterPage from "./page";

describe("RegisterPage cookie link (#163)", () => {
  it("links to the cookie section of the Datenschutzerklärung", () => {
    render(<RegisterPage />);
    expect(screen.getByRole("link", { name: "Cookie-Hinweise" })).toHaveAttribute(
      "href",
      "/datenschutz#cookies",
    );
  });
});
