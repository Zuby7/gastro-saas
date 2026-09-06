import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const fromMock = vi.fn();
const rpcMock = vi.fn();
const getAnalysisMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
    rpc: rpcMock,
  }),
}));

vi.mock("@/lib/analytics/dish-performance-service", () => ({
  getDishPerformanceAnalysis: (...args: unknown[]) => getAnalysisMock(...args),
}));

function membershipQueryChain(result: { data: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
  };
  return chain;
}

describe("DishPerformancePage (ticket #31)", () => {
  it("denies a member without analytics.read, never calling the analysis RPC", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "staff" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "insufficient_privilege" } });

    const { default: DishPerformancePage } = await import("./page");
    const element = await DishPerformancePage();
    render(element);

    expect(screen.getByText(/nicht die erforderliche Berechtigung/)).toBeInTheDocument();
    expect(getAnalysisMock).not.toHaveBeenCalled();
  });

  it("shows an honest empty state when there are no published dishes/data", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    getAnalysisMock.mockResolvedValueOnce([]);

    const { default: DishPerformancePage } = await import("./page");
    const element = await DishPerformancePage();
    render(element);

    expect(screen.getByText(/Noch keine veröffentlichten Gerichte/)).toBeInTheDocument();
  });

  it("renders both quantity and revenue rankings with evidence numbers and labels, never fabricating a low-performer flag without sufficient data", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    getAnalysisMock.mockResolvedValueOnce([
      {
        dishId: "d1",
        dishName: "Margherita",
        unitsSold: 100,
        revenueCents: 100_000,
        currency: "EUR",
        viewsCount: 200,
        addToCartCount: 150,
        evidenceCount: 450,
        conversionRate: 0.5,
        quantityRank: 1,
        revenueRank: 2,
        label: "topseller",
        manualUnitsSold: 0,
        manualEstimatedRevenueCents: 0,
      },
      {
        dishId: "d2",
        dishName: "Neuling",
        unitsSold: 0,
        revenueCents: 0,
        currency: "EUR",
        viewsCount: 1,
        addToCartCount: 0,
        evidenceCount: 1,
        conversionRate: null,
        quantityRank: 2,
        revenueRank: 1,
        label: "insufficient_data",
        manualUnitsSold: 0,
        manualEstimatedRevenueCents: 0,
      },
    ]);

    const { default: DishPerformancePage } = await import("./page");
    const element = await DishPerformancePage();
    render(element);

    expect(
      screen.getByRole("heading", { name: "Ranking nach verkaufter Menge" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ranking nach Umsatz" })).toBeInTheDocument();
    expect(screen.getAllByText("Margherita").length).toBe(2);
    expect(screen.getAllByText("Topseller").length).toBe(2);
    expect(screen.getAllByText("Zu wenig Daten").length).toBe(2);
    // The low-data dish must never show "Low Performer" -- see acceptance criterion 1.
    expect(screen.queryByText("Low Performer")).not.toBeInTheDocument();
  });

  it("discloses that Aufrufe/Warenkorb-Hinzufügungen aren't tracked yet whenever every row reads 0 (finding 5)", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    getAnalysisMock.mockResolvedValueOnce([
      {
        dishId: "d1",
        dishName: "Margherita",
        unitsSold: 5,
        revenueCents: 5_000,
        currency: "EUR",
        viewsCount: 0,
        addToCartCount: 0,
        evidenceCount: 5,
        conversionRate: null,
        quantityRank: 1,
        revenueRank: 1,
        label: "normal",
        manualUnitsSold: 0,
        manualEstimatedRevenueCents: 0,
      },
    ]);

    const { default: DishPerformancePage } = await import("./page");
    const element = await DishPerformancePage();
    render(element);

    expect(screen.getByText(/noch nicht verfügbar/)).toBeInTheDocument();
  });

  it("does not show the tracking-not-active disclosure once at least one dish has real view/add-to-cart data", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    getAnalysisMock.mockResolvedValueOnce([
      {
        dishId: "d1",
        dishName: "Margherita",
        unitsSold: 5,
        revenueCents: 5_000,
        currency: "EUR",
        viewsCount: 10,
        addToCartCount: 3,
        evidenceCount: 18,
        conversionRate: 0.5,
        quantityRank: 1,
        revenueRank: 1,
        label: "normal",
        manualUnitsSold: 0,
        manualEstimatedRevenueCents: 0,
      },
    ]);

    const { default: DishPerformancePage } = await import("./page");
    const element = await DishPerformancePage();
    render(element);

    expect(screen.queryByText(/noch nicht verfügbar/)).not.toBeInTheDocument();
  });

  it("formats revenue using the dish's own currency instead of a hardcoded EUR (finding 7)", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    getAnalysisMock.mockResolvedValueOnce([
      {
        dishId: "d1",
        dishName: "Burger",
        unitsSold: 5,
        revenueCents: 5_000,
        currency: "USD",
        viewsCount: 10,
        addToCartCount: 3,
        evidenceCount: 18,
        conversionRate: 0.5,
        quantityRank: 1,
        revenueRank: 1,
        label: "normal",
        manualUnitsSold: 0,
        manualEstimatedRevenueCents: 0,
      },
    ]);

    const { default: DishPerformancePage } = await import("./page");
    const element = await DishPerformancePage();
    render(element);

    expect(screen.getAllByText("50.00 USD").length).toBeGreaterThan(0);
    expect(screen.queryByText(/50\.00 EUR/)).not.toBeInTheDocument();
  });
});
