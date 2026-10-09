import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const rpcMock = vi.fn();
const fromMock = vi.fn();
const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
    rpc: rpcMock,
  }),
}));

vi.mock("./onboarding-button", () => ({
  OnboardingButton: ({ label }: { label: string }) => <button>{label}</button>,
}));

interface AccountRow {
  status: "pending" | "restricted" | "enabled";
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements_summary: string | null;
}

function setup(options: {
  membership?: { tenant_id: string; role: string } | null;
  account?: AccountRow | null;
  denied?: string[];
  unexpectedError?: string;
}) {
  const membership =
    options.membership === undefined
      ? { tenant_id: "tenant-1", role: "owner" }
      : options.membership;
  fromMock.mockImplementation((table: string) => ({
    select: () => ({
      eq: (column: string, value: string) => ({
        limit: () => ({ maybeSingle: async () => ({ data: membership }) }),
        maybeSingle: async () => {
          // tenant scoping must come from the membership, never anything else
          expect(table).toBe("payment_accounts");
          expect([column, value]).toEqual(["tenant_id", "tenant-1"]);
          return { data: options.account ?? null };
        },
      }),
    }),
  }));
  rpcMock.mockImplementation(async (_fn: string, args: { p_permission_key: string }) => {
    if (options.unexpectedError === args.p_permission_key) {
      throw new Error("db down");
    }
    return options.denied?.includes(args.p_permission_key)
      ? { data: null, error: { message: "denied" } }
      : { data: null, error: null };
  });
}

async function render(): Promise<string> {
  const { default: PaymentsPage } = await import("./page");
  return renderToStaticMarkup(await PaymentsPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });
});

describe("PaymentsPage", () => {
  it("redirects to /login when unauthenticated", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    setup({});
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("redirects to /account when the user has no membership", async () => {
    setup({ membership: null });
    await expect(render()).rejects.toThrow("NEXT_REDIRECT:/account");
  });

  it("shows only an access-denied message without payments.read", async () => {
    setup({ denied: ["payments.read"] });
    const html = await render();
    expect(html).toContain("nicht die erforderliche Berechtigung");
    expect(html).not.toContain("Stripe-Verbindungsstatus");
  });

  it("rethrows non-permission errors from the payments.read gate", async () => {
    setup({ unexpectedError: "payments.read" });
    await expect(render()).rejects.toThrow("db down");
  });

  it("shows the not-onboarded state with the start button for an owner", async () => {
    setup({ account: null });
    const html = await render();
    expect(html).toContain("Nicht verbunden");
    expect(html).toContain("noch kein Stripe-Konto verbunden");
    expect(html).toContain("Verbindung mit Stripe starten");
  });

  it("shows the pending state with the continue label", async () => {
    setup({
      account: {
        status: "pending",
        charges_enabled: false,
        payouts_enabled: false,
        requirements_summary: null,
      },
    });
    const html = await render();
    expect(html).toContain("Onboarding läuft");
    expect(html).toContain("Onboarding fortsetzen");
    expect(html).not.toContain("Offene Anforderungen");
  });

  it("shows the restricted state with open requirements", async () => {
    setup({
      account: {
        status: "restricted",
        charges_enabled: true,
        payouts_enabled: false,
        requirements_summary: "currently_due: 2",
      },
    });
    const html = await render();
    expect(html).toContain("Eingeschränkt");
    expect(html).toContain("Offene Anforderungen");
    expect(html).toContain("currently_due: 2");
    expect(html).toContain("Onboarding fortsetzen");
  });

  it("shows the enabled state with the re-open label", async () => {
    setup({
      account: {
        status: "enabled",
        charges_enabled: true,
        payouts_enabled: true,
        requirements_summary: null,
      },
    });
    const html = await render();
    expect(html).toContain("Aktiv");
    expect(html).toContain("Stripe-Onboarding erneut aufrufen");
  });

  it("hides the onboarding button for a member without payments.connect (read-only)", async () => {
    setup({ denied: ["payments.connect"], account: null });
    const html = await render();
    expect(html).toContain("Stripe-Verbindungsstatus");
    expect(html).toContain("Nur der Inhaber");
    expect(html).not.toContain("<button>");
  });

  it("rethrows non-permission errors from the payments.connect gate", async () => {
    setup({ unexpectedError: "payments.connect" });
    await expect(render()).rejects.toThrow("db down");
  });
});
