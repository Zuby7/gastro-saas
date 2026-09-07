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

  it(
    "the 'how it works' steps form a valid list (3 li directly inside the ol) -- " +
      "Opus review finding on PR #149: an ol with non-li direct children (a wrapping " +
      "connector/layout div) breaks the list/listitem ownership relation for assistive tech",
    () => {
      render(<Home />);

      const lists = screen.getAllByRole("list");
      // The "how it works" ol is the only <ol>/<ul> this page renders besides
      // the ticket mockup's order-line <ul> (hidden below lg, but still in
      // the DOM) -- find it by its 3 listitems each containing a step title.
      const howItWorksList = lists.find(
        (candidate) => candidate.tagName === "OL" && candidate.querySelectorAll("li").length === 3,
      );
      expect(howItWorksList).toBeDefined();
      const items = screen.getAllByRole("listitem", { hidden: true });
      const stepItems = items.filter((item) => howItWorksList!.contains(item));
      expect(stepItems).toHaveLength(3);
      for (const item of stepItems) {
        expect(item.parentElement).toBe(howItWorksList);
      }
    },
  );
});
