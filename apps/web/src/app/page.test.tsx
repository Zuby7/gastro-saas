import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home (Startseite)", () => {
  it("renders an accessible h1 heading", () => {
    render(<Home />);

    const heading = screen.getByRole("heading", { level: 1, name: "gastro-saas" });
    expect(heading).toBeInTheDocument();
  });
});
