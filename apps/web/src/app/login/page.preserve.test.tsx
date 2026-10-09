import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const loginAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ loginAction }));

import LoginPage from "./page";

describe("LoginPage keeps the e-mail after a failed login", () => {
  it("keeps the e-mail address when the server returns an error", async () => {
    loginAction.mockResolvedValue({ error: "E-Mail oder Passwort falsch." });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), {
      target: { value: "chef@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "wrong-pw" } });
    fireEvent.click(screen.getByRole("button", { name: /anmelden/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("falsch");
    expect(screen.getByLabelText("E-Mail-Adresse")).toHaveValue("chef@example.com");
  });
});
