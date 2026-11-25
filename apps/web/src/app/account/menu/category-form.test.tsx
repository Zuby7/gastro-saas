import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createCategoryAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ createCategoryAction }));

import { CategoryForm } from "./category-form";

describe("CategoryForm", () => {
  beforeEach(() => createCategoryAction.mockReset());

  it("keeps the typed name when the server returns an error", async () => {
    createCategoryAction.mockResolvedValue({ error: "Kategorie existiert bereits." });
    render(<CategoryForm />);

    fireEvent.change(screen.getByLabelText("Neue Kategorie"), { target: { value: "Pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("existiert bereits");
    expect(screen.getByLabelText("Neue Kategorie")).toHaveValue("Pizza");
  });

  it("clears the field after a successful create", async () => {
    createCategoryAction.mockResolvedValue({ success: "Angelegt." });
    render(<CategoryForm />);

    fireEvent.change(screen.getByLabelText("Neue Kategorie"), { target: { value: "Pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));

    await waitFor(() => expect(screen.getByLabelText("Neue Kategorie")).toHaveValue(""));
  });

  it("renders the inline field error linked by aria-describedby plus a role=alert summary", async () => {
    createCategoryAction.mockResolvedValue({
      error: "Bitte korrigieren Sie die markierten Felder.",
      fieldErrors: { name: "Bitte geben Sie einen Namen ein." },
    });
    render(<CategoryForm />);

    fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("markierten Felder");
    const input = screen.getByLabelText("Neue Kategorie");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")).toHaveTextContent("Namen ein");
  });

  it("shows a role=status success message that disappears on the next edit", async () => {
    createCategoryAction.mockResolvedValue({ success: "Kategorie wurde angelegt." });
    render(<CategoryForm />);

    fireEvent.change(screen.getByLabelText("Neue Kategorie"), { target: { value: "Pizza" } });
    fireEvent.click(screen.getByRole("button", { name: "Anlegen" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Kategorie wurde angelegt.");

    fireEvent.input(screen.getByLabelText("Neue Kategorie"), { target: { value: "Pasta" } });
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
