import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Home from "./page";

describe("Home (Startseite / marketing landing page)", () => {
  it("renders exactly one accessible h1 (the hero headline)", () => {
    render(<Home />);

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(
      "Ihr Restaurant verdient mehr als ein Kassenbuch und einen Stapel Papierkarten.",
    );
  });

  it("has a semantic h2 for every major section (features, how-it-works, closing CTA)", () => {
    render(<Home />);

    const h2s = screen.getAllByRole("heading", { level: 2 });
    expect(h2s.length).toBeGreaterThanOrEqual(3);
  });

  it("renders primary calls to action linking to registration", () => {
    render(<Home />);

    const registerLinks = screen.getAllByRole("link", { name: /registrieren/i });
    expect(registerLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of registerLinks) {
      expect(link).toHaveAttribute("href", "/register");
    }
  });

  it("renders a login link", () => {
    render(<Home />);

    const loginLinks = screen.getAllByRole("link", { name: /anmelden/i });
    expect(loginLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of loginLinks) {
      expect(link).toHaveAttribute("href", "/login");
    }
  });
});
