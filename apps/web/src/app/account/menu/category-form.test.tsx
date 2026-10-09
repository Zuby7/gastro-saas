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
});
