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
 * Ticket #146: public AGB page, mirroring `../impressum/page.test.tsx`'s
 * coverage (including the XSS regression test for tenant-authored free
 * text).
 */
describe("AgbPage", () => {
  it("renders the tenant's AGB free text", async () => {
    getPublicLegalPageMock.mockResolvedValue({
      tenantName: "Mario's Pizzeria",
      text: "Es gelten unsere AGB. Widerrufsrecht: 14 Tage.",
    });
    const { default: AgbPage } = await import("./page");

    render(await AgbPage({ params: Promise.resolve({ slug: "demo" }) }));

    expect(
      screen.getByRole("heading", { name: "AGB & Widerrufsrecht: Mario's Pizzeria" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Widerrufsrecht: 14 Tage/)).toBeInTheDocument();
    expect(getPublicLegalPageMock).toHaveBeenCalledWith("demo", "terms");
  });

  it("renders a fallback message when no AGB text has been set yet", async () => {
    getPublicLegalPageMock.mockResolvedValue({ tenantName: "Mario's Pizzeria", text: "" });
    const { default: AgbPage } = await import("./page");

    render(await AgbPage({ params: Promise.resolve({ slug: "demo" }) }));

    expect(
      screen.getByText("Für dieses Restaurant wurden noch keine AGB hinterlegt."),
    ).toBeInTheDocument();
  });

  it("never executes/renders tenant-authored free text as HTML (XSS regression)", async () => {
    const maliciousText = '<img src=x onerror="window.__xssAgb = true">Harmless text';
    getPublicLegalPageMock.mockResolvedValue({ tenantName: "Evil Tenant", text: maliciousText });
    const { default: AgbPage } = await import("./page");

    const { container } = render(await AgbPage({ params: Promise.resolve({ slug: "demo" }) }));

    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText(/<img src=x onerror=/)).toBeInTheDocument();
    expect((globalThis as { __xssAgb?: boolean }).__xssAgb).toBeUndefined();
  });

  it("calls notFound() when the tenant slug doesn't resolve", async () => {
    getPublicLegalPageMock.mockResolvedValue(null);
    const { default: AgbPage } = await import("./page");

    await expect(AgbPage({ params: Promise.resolve({ slug: "unknown" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });
});
