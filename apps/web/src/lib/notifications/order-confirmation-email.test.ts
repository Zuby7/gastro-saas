import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOrderConfirmationEmailContent,
  sendOrderConfirmationEmail,
} from "./order-confirmation-email";

const ORDER = {
  id: "11111111-2222-3333-4444-555555555555",
  tenant_id: "tenant-1",
  customer_name: "Max Mustermann",
  fulfillment_type: "pickup",
  table_identifier: null,
  total_cents: 2599,
  currency: "EUR",
};

const ITEMS = [
  {
    id: "item-1",
    dish_name_snapshot: "Margherita",
    variant_name_snapshot: "Groß",
    quantity: 2,
    unit_price_cents_snapshot: 1000,
  },
];

const SELECTIONS = [
  { order_item_id: "item-1", option_name_snapshot: "Extra Käse", price_delta_cents_snapshot: 100 },
];

const PROFILE = { display_name: "Pizzeria Bella", brand_color: "#ff0000" };

describe("buildOrderConfirmationEmailContent", () => {
  it("includes correct line items and prices, and never a raw Stripe id", () => {
    const lineItems = [{ label: "Margherita (Groß) + Extra Käse", quantity: 2, totalCents: 2200 }];

    const result = buildOrderConfirmationEmailContent({
      order: ORDER,
      lineItems,
      profile: PROFILE,
    });

    expect(result.html).toContain("Pizzeria Bella");
    expect(result.html).toContain("Margherita");
    expect(result.html).toContain("22,00");
    expect(result.html).toContain("25,99");
    expect(result.text).toContain("Margherita");
    expect(result.text).toContain("25,99");
    expect(result.html).not.toContain("pi_test");
    expect(result.html).not.toContain("cs_test");
  });

  it("falls back to a generic name/color when no restaurant profile exists", () => {
    const result = buildOrderConfirmationEmailContent({
      order: ORDER,
      lineItems: [],
      profile: null,
    });

    expect(result.subject).toContain("Ihr Restaurant");
  });
});

describe("sendOrderConfirmationEmail", () => {
  const inserts: unknown[] = [];

  function makeAdmin() {
    return {
      from(table: string) {
        if (table === "orders") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: ORDER, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "order_items") {
          return {
            select: () => ({
              eq: async () => ({ data: ITEMS, error: null }),
            }),
          };
        }
        if (table === "order_item_selections") {
          return {
            select: () => ({
              in: async () => ({ data: SELECTIONS, error: null }),
            }),
          };
        }
        if (table === "restaurant_profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: PROFILE, error: null }),
              }),
            }),
          };
        }
        if (table === "email_sends") {
          return {
            insert: async (payload: unknown) => {
              inserts.push(payload);
              return { error: null };
            },
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    };
  }

  beforeEach(() => {
    inserts.length = 0;
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends a confirmation email with correct line items/prices via Resend and records a 'sent' row", async () => {
    const admin = makeAdmin();

    await sendOrderConfirmationEmail(admin as never, {
      tenantId: "tenant-1",
      orderId: ORDER.id,
      recipientEmail: "guest@example.com",
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({ method: "POST" }),
    );
    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse(fetchCall[1].body);
    expect(body.to).toBe("guest@example.com");
    expect(body.html).toContain("22,00");
    expect(body.text).toContain("22,00");
    expect(inserts).toEqual([expect.objectContaining({ status: "sent", order_id: ORDER.id })]);
  });

  it("never throws when Resend responds with a rate-limit (daily-cap) style 429, and records a visible failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "rate limited" }), { status: 429 })),
    );
    const admin = makeAdmin();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendOrderConfirmationEmail(admin as never, {
        tenantId: "tenant-1",
        orderId: ORDER.id,
        recipientEmail: "guest@example.com",
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("RATE LIMITED"), ORDER.id);
    expect(inserts).toEqual([
      expect.objectContaining({ status: "failed", failure_reason: "resend_rate_limited" }),
    ]);

    consoleErrorSpy.mockRestore();
  });

  it("never throws when fetch itself rejects (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const admin = makeAdmin();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendOrderConfirmationEmail(admin as never, {
        tenantId: "tenant-1",
        orderId: ORDER.id,
        recipientEmail: "guest@example.com",
      }),
    ).resolves.toBeUndefined();

    expect(inserts).toEqual([
      expect.objectContaining({ status: "failed", failure_reason: "unexpected_error" }),
    ]);

    consoleErrorSpy.mockRestore();
  });

  it("skips sending and records a failure when no recipient email is available", async () => {
    const admin = makeAdmin();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendOrderConfirmationEmail(admin as never, {
      tenantId: "tenant-1",
      orderId: ORDER.id,
      recipientEmail: null,
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(inserts).toEqual([
      expect.objectContaining({ status: "failed", failure_reason: "no_recipient_email" }),
    ]);

    consoleErrorSpy.mockRestore();
  });
});
