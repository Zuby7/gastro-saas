import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BRAND_NAME, DEMO_HREF, FAQS, PAYMENT_METHODS } from "./_landing/content";
import Home from "./page";

describe("Home (Startseite / marketing landing page)", () => {
  it("renders exactly one accessible h1 (the hero headline)", () => {
    render(<Home />);

    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Speisekarte, Bestellung und Zahlung in einem System");
  });

  it("has a semantic h2 for every major section", () => {
    const { container } = render(<Home />);

    const h2s = screen.getAllByRole("heading", { level: 2 });
    expect(h2s.length).toBeGreaterThanOrEqual(9);
    // Every section with a heading is labelled by it.
    for (const h2 of h2s) {
      expect(container.querySelector(`[aria-labelledby="${h2.id}"]`)).not.toBeNull();
    }
  });

  it("offers a skip link to the main content", () => {
    const { container } = render(<Home />);

    const skip = screen.getByRole("link", { name: "Zum Inhalt springen" });
    expect(skip).toHaveAttribute("href", "#inhalt");
    expect(container.querySelector("main#inhalt")).not.toBeNull();
  });

  it("links the demo, registration and login CTAs to the existing routes", () => {
    render(<Home />);

    for (const link of screen.getAllByRole("link", { name: "Live-Demo ansehen" })) {
      expect(link).toHaveAttribute("href", DEMO_HREF);
    }
    expect(DEMO_HREF).toBe("/r/trattoria-da-mario");

    const registerLinks = screen.getAllByRole("link", { name: /registrieren/i });
    expect(registerLinks.length).toBeGreaterThanOrEqual(3);
    for (const link of registerLinks) {
      expect(link).toHaveAttribute("href", "/register");
    }

    const loginLinks = screen.getAllByRole("link", { name: "Login" });
    expect(loginLinks.length).toBeGreaterThanOrEqual(2);
    for (const link of loginLinks) {
      expect(link).toHaveAttribute("href", "/login");
    }
  });

  it("uses the brand constant as the product name", () => {
    render(<Home />);

    expect(BRAND_NAME).toBe("Gastro-SaaS");
    expect(screen.getAllByText(new RegExp(BRAND_NAME)).length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toMatch(/gastro-saas/);
  });

  it("shows the payment methods as chips and makes no PayPal claim", () => {
    const { container } = render(<Home />);

    const list = screen.getByRole("list", { name: "Zahlungsarten" });
    const chips = Array.from(list.querySelectorAll("li")).map((li) => li.textContent);
    expect(chips).toEqual([...PAYMENT_METHODS]);
    expect(chips).toEqual(["Karte", "Apple Pay", "Klarna", "Link", "Bank"]);
    expect(container.textContent).not.toMatch(/paypal/i);
  });

  it("states the pilot phase / test mode honestly", () => {
    render(<Home />);

    expect(screen.getByText(/Pilotphase \/ Testmodus:/)).toBeInTheDocument();
  });

  it("the three steps are numbered 01-03 and form a valid list", () => {
    const { container } = render(<Home />);

    const steps = Array.from(container.querySelectorAll("ol > li"));
    expect(steps).toHaveLength(3);
    expect(steps.map((li) => li.textContent?.slice(0, 2))).toEqual(["01", "02", "03"]);
  });

  it("renders the FAQ as native details/summary (keyboard accessible, no JS)", () => {
    const { container } = render(<Home />);

    const details = container.querySelectorAll("details");
    expect(details).toHaveLength(FAQS.length);
    for (const item of Array.from(details)) {
      expect(item.querySelector(":scope > summary")).not.toBeNull();
    }
  });

  it("every image has alt text, intrinsic size and lazy/async loading (hero excepted)", () => {
    const { container } = render(<Home />);

    const images = Array.from(container.querySelectorAll("img"));
    expect(images.length).toBeGreaterThanOrEqual(8);
    for (const img of images) {
      expect(img.getAttribute("alt")?.length ?? 0).toBeGreaterThan(10);
      expect(img.getAttribute("width")).toBeTruthy();
      expect(img.getAttribute("height")).toBeTruthy();
      expect(img.getAttribute("src")).toMatch(/^\/landing\/[a-z-]+\.webp$/);
      expect(img.getAttribute("decoding")).toBe("async");
    }
    const lazy = images.filter((img) => img.getAttribute("loading") === "lazy");
    expect(lazy.length).toBeGreaterThanOrEqual(6);
  });

  it("decorative glow layers are aria-hidden", () => {
    const { container } = render(<Home />);

    const glows = container.querySelectorAll(".lp-glow");
    expect(glows.length).toBeGreaterThan(0);
    for (const glow of Array.from(glows)) {
      expect(glow.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("uses no em dashes or en dashes in the visible copy", () => {
    const { container } = render(<Home />);

    expect(container.textContent).not.toMatch(/[–—]/);
  });

  it("invents no prices, statistics or contact data", () => {
    const { container } = render(<Home />);
    const text = container.textContent ?? "";

    expect(text).not.toMatch(/€|EUR|\d+\s?%|@|\+49|tel\./i);
  });

  it("has a footer link to the cookie settings", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: "Cookie-Hinweise" })).toHaveAttribute(
      "href",
      "/datenschutz#cookies",
    );
  });
});
