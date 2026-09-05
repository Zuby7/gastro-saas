import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPublicLegalPageMock = vi.fn();

vi.mock("@/lib/public-menu/fetch", () => ({
  getPublicLegalPage: (...args: unknown[]) => getPublicLegalPageMock(...args),
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Ticket #41: public Impressum page. The XSS regression test is the ticket's
 * required "XSS-Test für Freitext-Rendering" -- asserts the tenant-authored
 * free text is rendered as an inert text node (React's default escaping),
 * never interpreted as HTML/executed as script.
 */
describe("ImpressumPage", () => {
  it("renders the tenant's Impressum free text", async () => {
    getPublicLegalPageMock.mockResolvedValue({
      tenantName: "Mario's Pizzeria",
      text: "Mario GmbH\nMusterstraße 1\n12345 Berlin",
    });
    const { default: ImpressumPage } = await import("./page");

    render(await ImpressumPage({ params: Promise.resolve({ slug: "demo" }) }));

    expect(
      screen.getByRole("heading", { name: "Impressum – Mario's Pizzeria" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Mario GmbH/)).toBeInTheDocument();
  });

  it("renders a fallback message when no Impressum text has been set yet", async () => {
    getPublicLegalPageMock.mockResolvedValue({ tenantName: "Mario's Pizzeria", text: "" });
    const { default: ImpressumPage } = await import("./page");

    render(await ImpressumPage({ params: Promise.resolve({ slug: "demo" }) }));

    expect(
      screen.getByText("Für dieses Restaurant wurde noch kein Impressum hinterlegt."),
    ).toBeInTheDocument();
  });

  it("never executes/renders tenant-authored free text as HTML (XSS regression)", async () => {
    const maliciousText = '<img src=x onerror="window.__xss = true">Harmless text';
    getPublicLegalPageMock.mockResolvedValue({ tenantName: "Evil Tenant", text: maliciousText });
    const { default: ImpressumPage } = await import("./page");

    const { container } = render(await ImpressumPage({ params: Promise.resolve({ slug: "demo" }) }));

    // The literal markup must appear as plain visible text, not be parsed
    // into a real <img> element -- proving React's text-node escaping (not
    // dangerouslySetInnerHTML) is what's rendering this field.
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=/)).toBeInTheDocument();
    expect((globalThis as { __xss?: boolean }).__xss).toBeUndefined();
  });

  it("calls notFound() when the tenant slug doesn't resolve", async () => {
    getPublicLegalPageMock.mockResolvedValue(null);
    const { default: ImpressumPage } = await import("./page");

    await expect(
      ImpressumPage({ params: Promise.resolve({ slug: "unknown" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
