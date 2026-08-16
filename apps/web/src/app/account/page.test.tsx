import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const getUserMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

function membershipQueryChain(result: { data: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    order: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
    returns: vi.fn(async () => result),
  };
  return chain;
}

describe("AccountPage", () => {
  it("prefills the create-tenant fallback form with tenant name/slug carried in user_metadata (ticket #60)", async () => {
    getUserMock.mockResolvedValueOnce({
      data: {
        user: {
          id: "user-1",
          email: "owner@example.com",
          user_metadata: { tenant_name: "Pizzeria Napoli", tenant_slug: "pizzeria-napoli" },
        },
      },
    });
    fromMock.mockReturnValueOnce(membershipQueryChain({ data: null }));

    const { default: AccountPage } = await import("./page");
    const element = await AccountPage();
    render(element);

    expect(screen.getByLabelText("Restaurantname")).toHaveValue("Pizzeria Napoli");
    expect(
      screen.getByLabelText("Restaurant-Slug (für Ihre öffentliche Speisekarten-URL)"),
    ).toHaveValue("pizzeria-napoli");
  });

  it("renders the fallback form without prefill when there is no tenant metadata", async () => {
    getUserMock.mockResolvedValueOnce({
      data: {
        user: { id: "user-2", email: "new@example.com", user_metadata: {} },
      },
    });
    fromMock.mockReturnValueOnce(membershipQueryChain({ data: null }));

    const { default: AccountPage } = await import("./page");
    const element = await AccountPage();
    render(element);

    expect(screen.getByLabelText("Restaurantname")).toHaveValue("");
  });
});
