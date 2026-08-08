import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const constructEventMock = vi.fn();
const insertWebhookEventMock = vi.fn();
const updatePaymentAccountMock = vi.fn();
const updateWebhookEventMock = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  createStripeClient: () => ({
    webhooks: { constructEvent: constructEventMock },
  }),
  getStripeConnectWebhookSecret: () => "whsec_test",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === "payment_webhook_events") {
        return {
          insert: insertWebhookEventMock,
          update: (payload: unknown) => {
            updateWebhookEventMock(payload);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === "payment_accounts") {
        return {
          update: (payload: unknown) => {
            updatePaymentAccountMock(payload);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

function makeRequest(body: string, signature: string | null = "sig_test") {
  const headers: Record<string, string> = {};
  if (signature) headers["stripe-signature"] = signature;
  return new NextRequest("http://localhost/api/webhooks/stripe-connect", {
    method: "POST",
    body,
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertWebhookEventMock.mockResolvedValue({ error: null });
});

describe("POST /api/webhooks/stripe-connect", () => {
  it("rejects requests without a stripe-signature header", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}", null));
    expect(response.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
  });

  it("rejects requests with an invalid signature", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));
    expect(response.status).toBe(400);
    expect(insertWebhookEventMock).not.toHaveBeenCalled();
  });

  it("deduplicates by event ID and does not reprocess a duplicate delivery", async () => {
    constructEventMock.mockReturnValue({ id: "evt_1", type: "account.updated", account: "acct_1" });
    insertWebhookEventMock.mockResolvedValue({ error: { code: "23505" } });

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));
    const json = await response.json();

    expect(json).toEqual({ received: true, duplicate: true });
    expect(updatePaymentAccountMock).not.toHaveBeenCalled();
  });

  it("updates payment_accounts on a verified account.updated event", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_2",
      type: "account.updated",
      account: "acct_1",
      data: {
        object: {
          id: "acct_1",
          charges_enabled: true,
          payouts_enabled: true,
          requirements: { disabled_reason: null, currently_due: [], past_due: [] },
        },
      },
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));
    const json = await response.json();

    expect(json).toEqual({ received: true });
    expect(updatePaymentAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "enabled", charges_enabled: true, payouts_enabled: true }),
    );
  });

  it("ignores unrelated event types but still dedups/acknowledges them", async () => {
    constructEventMock.mockReturnValue({ id: "evt_3", type: "account.application.deauthorized" });

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));
    const json = await response.json();

    expect(json).toEqual({ received: true });
    expect(updatePaymentAccountMock).not.toHaveBeenCalled();
  });
});
