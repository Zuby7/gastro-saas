import { beforeEach, describe, expect, it, vi } from "vitest";

let result: { data: { provider: string } | null } | Error;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("payments");
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => {
                  if (result instanceof Error) throw result;
                  return result;
                },
              }),
            }),
          }),
        }),
      };
    },
  }),
}));

import { getPaidPaymentMethodLabel } from "./payment-method-label";

beforeEach(() => {
  result = { data: null };
});

describe("getPaidPaymentMethodLabel", () => {
  it("labels a paid Mollie payment as PayPal", async () => {
    result = { data: { provider: "mollie" } };
    await expect(getPaidPaymentMethodLabel("order-1")).resolves.toBe("PayPal");
  });

  it("returns null for Stripe payments and for orders without a paid payment", async () => {
    result = { data: { provider: "stripe" } };
    await expect(getPaidPaymentMethodLabel("order-1")).resolves.toBeNull();
    result = { data: null };
    await expect(getPaidPaymentMethodLabel("order-1")).resolves.toBeNull();
  });

  it("falls back to null instead of throwing when the lookup fails", async () => {
    result = new Error("db down");
    await expect(getPaidPaymentMethodLabel("order-1")).resolves.toBeNull();
  });
});
