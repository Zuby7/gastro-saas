import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryNav } from "./category-nav";

const categories = [
  { id: "a", name: "Vorspeisen" },
  { id: "b", name: "Hauptgerichte" },
  { id: "c", name: "Desserts" },
];

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  for (const category of categories) {
    const section = document.createElement("section");
    section.id = `category-${category.id}`;
    document.body.appendChild(section);
  }
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("CategoryNav", () => {
  it("marks a tab active immediately on click", () => {
    render(<CategoryNav categories={categories} />);
    fireEvent.click(screen.getByRole("link", { name: "Desserts" }));

    expect(screen.getByRole("link", { name: "Desserts" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "Vorspeisen" })).not.toHaveAttribute("aria-current");
  });

  it("activates the last category when the page is scrolled to the bottom", () => {
    render(<CategoryNav categories={categories} />);

    Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 1700,
      configurable: true,
    });
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(screen.getByRole("link", { name: "Desserts" })).toHaveAttribute("aria-current", "true");
  });

  it("gives every tab a 44 px minimum height", () => {
    render(<CategoryNav categories={categories} />);
    expect(screen.getByRole("link", { name: "Vorspeisen" })).toHaveClass("min-h-11");
  });
});
