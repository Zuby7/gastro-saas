import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("renders a form with a function action (never a bare GET form) and clears only the password", async () => {
    loginAction.mockResolvedValue({ error: "E-Mail oder Passwort falsch." });
    const { container } = render(<LoginPage />);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("action")).toMatch(/^javascript:/);
    expect(form.getAttribute("method")?.toLowerCase() ?? "post").not.toBe("get");

    fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), { target: { value: "a@b.de" } });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "wrong-pw" } });
    fireEvent.click(screen.getByRole("button", { name: /anmelden/i }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByLabelText("Passwort")).toHaveValue(""));
    expect(screen.getByLabelText("E-Mail-Adresse")).toHaveValue("a@b.de");
  });
});
