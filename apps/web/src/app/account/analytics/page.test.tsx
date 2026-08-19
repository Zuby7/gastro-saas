import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnalyticsDashboardSummary } from "@/lib/analytics/dashboard-service";

const getUserMock = vi.fn();
const fromMock = vi.fn();
const rpcMock = vi.fn();
const getSummaryMock = vi.fn();

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

vi.mock("@/lib/analytics/dashboard-service", () => ({
  getAnalyticsDashboardSummary: (...args: unknown[]) => getSummaryMock(...args),
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

function baseSummary(
  overrides: Partial<AnalyticsDashboardSummary> = {},
): AnalyticsDashboardSummary {
  return {
    timezone: "Europe/Berlin",
    dayStart: "2026-08-18T00:00:00+02:00",
    dayEnd: "2026-08-19T00:00:00+02:00",
    currency: "EUR",
    grossRevenueTodayCents: 0,
    refundsTodayCents: 0,
    netRevenueTodayCents: 0,
    paidOrdersTodayCount: 0,
    avgOrderValueCents: null,
    openOrdersCount: 0,
    paymentFailuresTodayCount: 0,
    ...overrides,
  };
}

describe("AnalyticsDashboardPage (ticket #30)", () => {
  it("denies a member without analytics.read with a clear access-denied message, never calling the summary RPC", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "staff" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "insufficient_privilege" } });

    const { default: AnalyticsDashboardPage } = await import("./page");
    const element = await AnalyticsDashboardPage();
    render(element);

    expect(screen.getByText(/nicht die erforderliche Berechtigung/)).toBeInTheDocument();
    expect(getSummaryMock).not.toHaveBeenCalled();
  });

  it("shows an honest empty state (no fabricated numbers) when there is no data yet", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    getSummaryMock.mockResolvedValueOnce(baseSummary());

    const { default: AnalyticsDashboardPage } = await import("./page");
    const element = await AnalyticsDashboardPage();
    render(element);

    expect(screen.getByText("Umsatz heute (netto)")).toBeInTheDocument();
    expect(screen.getAllByText("Noch keine bezahlten Bestellungen heute.").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByText("Noch nicht genug Daten für einen Durchschnittswert."),
    ).toBeInTheDocument();
    // Average order value renders as an em dash, never a fabricated "0,00 EUR".
    expect(screen.queryByText("0.00 EUR")).not.toBeInTheDocument();
  });

  it("renders real revenue/order figures, net of refunds, when there is data", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: "user-1" } } });
    fromMock.mockReturnValueOnce(
      membershipQueryChain({ data: { tenant_id: "tenant-1", role: "owner" } }),
    );
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    getSummaryMock.mockResolvedValueOnce(
      baseSummary({
        grossRevenueTodayCents: 4000,
        refundsTodayCents: 1500,
        netRevenueTodayCents: 2500,
        paidOrdersTodayCount: 1,
        avgOrderValueCents: 4000,
        openOrdersCount: 2,
        paymentFailuresTodayCount: 1,
      }),
    );

    const { default: AnalyticsDashboardPage } = await import("./page");
    const element = await AnalyticsDashboardPage();
    render(element);

    expect(screen.getByText("25.00 EUR")).toBeInTheDocument();
    expect(
      screen.getByText(/Brutto 40.00 EUR, abzüglich 15.00 EUR Rückerstattungen/),
    ).toBeInTheDocument();
    expect(screen.getByText("40.00 EUR")).toBeInTheDocument();
  });
});
