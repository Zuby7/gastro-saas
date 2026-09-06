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

describe("DatenschutzPage", () => {
  it("renders the tenant's Datenschutzerklärung free text", async () => {
    getPublicLegalPageMock.mockResolvedValue({
      tenantName: "Mario's Pizzeria",
      text: "Wir verarbeiten Ihre Daten gemäß DSGVO.",
    });
    const { default: DatenschutzPage } = await import("./page");

    render(await DatenschutzPage({ params: Promise.resolve({ slug: "demo" }) }));

    expect(
      screen.getByRole("heading", { name: "Datenschutzerklärung: Mario's Pizzeria" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Wir verarbeiten Ihre Daten gemäß DSGVO\./)).toBeInTheDocument();
  });

  it("renders a fallback message when no Datenschutz text has been set yet", async () => {
    getPublicLegalPageMock.mockResolvedValue({ tenantName: "Mario's Pizzeria", text: "" });
    const { default: DatenschutzPage } = await import("./page");

    render(await DatenschutzPage({ params: Promise.resolve({ slug: "demo" }) }));

    expect(
      screen.getByText("Für dieses Restaurant wurde noch keine Datenschutzerklärung hinterlegt."),
    ).toBeInTheDocument();
  });

  it("never executes/renders tenant-authored free text as HTML (XSS regression)", async () => {
    const maliciousText = '<img src=x onerror="window.__xssDatenschutz = true">Harmless';
    getPublicLegalPageMock.mockResolvedValue({ tenantName: "Evil Tenant", text: maliciousText });
    const { default: DatenschutzPage } = await import("./page");

    const { container } = render(
      await DatenschutzPage({ params: Promise.resolve({ slug: "demo" }) }),
    );

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=/)).toBeInTheDocument();
    expect((globalThis as { __xssDatenschutz?: boolean }).__xssDatenschutz).toBeUndefined();
  });

  it("calls notFound() when the tenant slug doesn't resolve", async () => {
    getPublicLegalPageMock.mockResolvedValue(null);
    const { default: DatenschutzPage } = await import("./page");

    await expect(DatenschutzPage({ params: Promise.resolve({ slug: "unknown" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });
});
