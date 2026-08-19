import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RatingForm } from "./rating-form";

vi.mock("./rating-actions", () => ({
  submitRatingAction: async () => ({}),
}));

/**
 * Semantic-structure a11y coverage for `RatingForm` (ticket #33), mirroring
 * `CheckoutForm`'s established test pattern for this codebase.
 */
describe("RatingForm accessibility", () => {
  it("groups the star choice under a labeled fieldset/legend with all five options", () => {
    render(<RatingForm tenantSlug="demo" token="raw-token" />);

    expect(screen.getByRole("group", { name: "Bewertung" })).toBeInTheDocument();
    for (const label of ["1 Stern", "2 Sterne", "3 Sterne", "4 Sterne", "5 Sterne"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
  });

  it("labels the optional comment field", () => {
    render(<RatingForm tenantSlug="demo" token="raw-token" />);

    const comment = screen.getByLabelText("Kommentar (optional)");
    expect(comment).not.toBeRequired();
  });

  it("exposes a submit button", () => {
    render(<RatingForm tenantSlug="demo" token="raw-token" />);

    expect(screen.getByRole("button", { name: "Bewertung abschicken" })).toBeInTheDocument();
  });
});
