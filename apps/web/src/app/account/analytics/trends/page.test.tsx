import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const fromMock = vi.fn();
const rpcMock = vi.fn();
const getTrendComparisonMock = vi.fn();
const getExtrasPerformanceMock = vi.fn();

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

vi.mock("@/lib/analytics/trend-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/analytics/trend-service")>(
    "@/lib/analytics/trend-service",
  );
  return {
    ...actual,
    getTrendComparison: (...args: unknown[]) => getTrendComparisonMock(...args),
  };
});

vi.mock("@/lib/analytics/extras-service", () => ({
  getExtrasPerformance: (...args: unknown[]) => getExtrasPerformanceMock(...args),
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

function baseTrend(overrides: Record<string, unknown> = {}) {
  return {
    timezone: "Europe/Berlin",
    currency: "EUR",
    periodType: "day",
    current: {
      start: "2026-08-18T00:00:00+02:00",
      end: "2026-08-19T00:00:00+02:00",
      isComplete: true,
      grossRevenueCents: 12_000,
      netRevenueCents: 12_000,
      paidOrdersCount: 12,
    },
    previous: {
      start: "2026-08-17T00:00:00+02:00",
      end: "2026-08-18T00:00:00+02:00",
      isComplete: true,
      grossRevenueCents: 10_000,
      netRevenueCents: 10_000,
      paidOrdersCount: 10,
    },
    netRevenueChangePercent: 20,
    paidOrdersChangePercent: 20,
    isComparisonReliable: true,
    comparisonCaveat: null,
    ...overrides,
  };
}

describe("TrendsAndExtrasPage (ticket #32)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies a member without analytics.read, never calling either analysis RPC", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "staff" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "insufficient_privilege" } });

    const { default: TrendsAndExtrasPage } = await import("./page");
    const element = await TrendsAndExtrasPage({ searchParams: Promise.resolve({}) });
    render(element);

    expect(screen.getByText(/nicht die erforderliche Berechtigung/)).toBeInTheDocument();
    expect(getTrendComparisonMock).not.toHaveBeenCalled();
    expect(getExtrasPerformanceMock).not.toHaveBeenCalled();
  });

  it("renders the comparison caveat alongside the numbers when the current period is incomplete (acceptance criterion 1)", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    getTrendComparisonMock.mockResolvedValueOnce(
      baseTrend({
        comparisonCaveat:
          "Der aktuelle Zeitraum ist noch nicht abgeschlossen -- der Vergleich mit dem vollständigen Vorzeitraum ist nur eingeschränkt aussagekräftig.",
        isComparisonReliable: false,
        current: {
          ...baseTrend().current,
          isComplete: false,
          netRevenueCents: 4000,
          paidOrdersCount: 3,
        },
      }),
    );
    getExtrasPerformanceMock.mockResolvedValueOnce([]);

    const { default: TrendsAndExtrasPage } = await import("./page");
    const element = await TrendsAndExtrasPage({ searchParams: Promise.resolve({}) });
    render(element);

    // The caveat must be shown, AND the raw numbers must still be shown
    // alongside it -- never hidden (ticket #32: "nicht unkommentiert", not
    // "nicht dargestellt").
    expect(screen.getByText(/noch nicht abgeschlossen/)).toBeInTheDocument();
    expect(screen.getByText("40.00 EUR")).toBeInTheDocument();
  });

  it("renders both trend numbers and extras evidence when the comparison is reliable", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    getTrendComparisonMock.mockResolvedValueOnce(baseTrend());
    getExtrasPerformanceMock.mockResolvedValueOnce([
      {
        optionId: "extra-cheese",
        optionName: "Extra Käse",
        priceDeltaCents: 150,
        eligibleOrderItemCount: 40,
        selectionCount: 10,
        additionalRevenueCents: 1500,
        selectionRate: 0.25,
      },
    ]);

    const { default: TrendsAndExtrasPage } = await import("./page");
    const element = await TrendsAndExtrasPage({ searchParams: Promise.resolve({}) });
    render(element);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("120.00 EUR")).toBeInTheDocument();
    expect(screen.getByText("Extra Käse")).toBeInTheDocument();
    expect(screen.getByText("25.0 %")).toBeInTheDocument();
    expect(screen.getByText("15.00 EUR")).toBeInTheDocument();
  });

  it("shows the explicit 'not yet available' message for removed-ingredient analysis, never a fabricated empty table", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    getTrendComparisonMock.mockResolvedValueOnce(baseTrend());
    getExtrasPerformanceMock.mockResolvedValueOnce([]);

    const { default: TrendsAndExtrasPage } = await import("./page");
    const element = await TrendsAndExtrasPage({ searchParams: Promise.resolve({}) });
    render(element);

    expect(screen.getByText(/noch nicht verfügbar/)).toBeInTheDocument();
  });

  it("never renders a raw Postgres error message, only the mapped German text (ticket #120)", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const rawPostgresMessage =
      'new row for relation "orders" violates check constraint "orders_status_check" (SQLSTATE 23514)';
    getTrendComparisonMock.mockRejectedValueOnce(new Error(rawPostgresMessage));
    getExtrasPerformanceMock.mockResolvedValueOnce([]);

    const { default: TrendsAndExtrasPage } = await import("./page");
    const element = await TrendsAndExtrasPage({ searchParams: Promise.resolve({}) });
    render(element);

    expect(
      screen.getByText("Der Zeitraumvergleich konnte nicht geladen werden."),
    ).toBeInTheDocument();
    expect(screen.queryByText(rawPostgresMessage)).not.toBeInTheDocument();
    expect(screen.queryByText(/SQLSTATE/)).not.toBeInTheDocument();
    expect(screen.queryByText(/check constraint/)).not.toBeInTheDocument();
  });

  it("prompts for start/end dates instead of calling the RPC when period=custom and dates are missing", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    getExtrasPerformanceMock.mockResolvedValueOnce([]);

    const { default: TrendsAndExtrasPage } = await import("./page");
    const element = await TrendsAndExtrasPage({
      searchParams: Promise.resolve({ period: "custom" }),
    });
    render(element);

    expect(getTrendComparisonMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Start- und Enddatum für den freien Zeitraum/)).toBeInTheDocument();
  });
});
