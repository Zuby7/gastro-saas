import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const registerAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ registerAction }));

import RegisterPage from "./page";

describe("RegisterPage keeps entered values after a validation error", () => {
  it("keeps restaurant name, slug, e-mail and the ticked consent", async () => {
    registerAction.mockResolvedValue({ error: "Bitte prüfen Sie Ihre Eingaben." });
    render(<RegisterPage />);

    fireEvent.change(screen.getByLabelText("Restaurantname"), { target: { value: "Zur Post" } });
    fireEvent.change(screen.getByLabelText(/Web-Adresse/), { target: { value: "zur-post" } });
    fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), {
      target: { value: "wirt@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Passwort"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /registrieren|konto/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Eingaben");
    expect(screen.getByLabelText("Restaurantname")).toHaveValue("Zur Post");
    expect(screen.getByLabelText(/Web-Adresse/)).toHaveValue("zur-post");
    expect(screen.getByLabelText("E-Mail-Adresse")).toHaveValue("wirt@example.com");
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("renders a form with a function action (never a bare GET form)", () => {
    const { container } = render(<RegisterPage />);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("action")).toMatch(/^javascript:/);
    expect(form.getAttribute("method")?.toLowerCase() ?? "post").not.toBe("get");
  });
});
