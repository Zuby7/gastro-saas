import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const submitRatingAction = vi.hoisted(() => vi.fn());
vi.mock("./rating-actions", () => ({ submitRatingAction }));

import { RatingForm } from "./rating-form";

describe("RatingForm keeps input after an error", () => {
  it("keeps the selected stars and the comment", async () => {
    submitRatingAction.mockResolvedValue({ error: "Bewertung konnte nicht gespeichert werden." });
    render(<RatingForm tenantSlug="demo" token="raw-token" />);

    fireEvent.click(screen.getByRole("radio", { name: "4 Sterne" }));
    fireEvent.change(screen.getByLabelText("Kommentar (optional)"), {
      target: { value: "Sehr lecker" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Bewertung abschicken" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("nicht gespeichert");
    expect(screen.getByRole("radio", { name: "4 Sterne" })).toBeChecked();
    expect(screen.getByLabelText("Kommentar (optional)")).toHaveValue("Sehr lecker");
  });
});
