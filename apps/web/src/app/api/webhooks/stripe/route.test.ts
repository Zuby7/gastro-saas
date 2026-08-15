import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const constructEventMock = vi.fn();
const insertWebhookEventMock = vi.fn();
const updateWebhookEventMock = vi.fn();
const handleStripePaymentWebhookEventMock = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  createStripeClient: () => ({
    webhooks: { constructEvent: constructEventMock },
  }),
  getStripePaymentsWebhookSecret: () => "whsec_test",
}));

vi.mock("@/lib/payments/webhook-service", () => ({
  handleStripePaymentWebhookEvent: (...args: unknown[]) =>
    handleStripePaymentWebhookEventMock(...args),
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
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

function makeRequest(body: string, signature: string | null = "sig_test") {
  const headers: Record<string, string> = {};
  if (signature) headers["stripe-signature"] = signature;
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertWebhookEventMock.mockResolvedValue({ error: null });
  handleStripePaymentWebhookEventMock.mockResolvedValue(undefined);
});

describe("POST /api/webhooks/stripe", () => {
  it("rejects requests without a stripe-signature header", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}", null));
    expect(response.status).toBe(400);
    expect(constructEventMock).not.toHaveBeenCalled();
  });

  it("rejects requests with an invalid signature, and never calls the processing logic", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));
    expect(response.status).toBe(400);
    expect(insertWebhookEventMock).not.toHaveBeenCalled();
    expect(handleStripePaymentWebhookEventMock).not.toHaveBeenCalled();
  });

  it("verifies against the raw request body text, not a re-parsed/re-serialized body", async () => {
    constructEventMock.mockReturnValue({ id: "evt_1", type: "checkout.session.completed" });
    const rawBody = '{"raw":   "spacing preserved"}';

    const { POST } = await import("./route");
    await POST(makeRequest(rawBody));

    expect(constructEventMock).toHaveBeenCalledWith(rawBody, "sig_test", "whsec_test");
  });

  it("deduplicates by event ID and never calls the processing logic for a duplicate delivery", async () => {
    constructEventMock.mockReturnValue({ id: "evt_1", type: "checkout.session.completed" });
    insertWebhookEventMock.mockResolvedValue({ error: { code: "23505" } });

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));
    const json = await response.json();

    expect(json).toEqual({ received: true, duplicate: true });
    expect(handleStripePaymentWebhookEventMock).not.toHaveBeenCalled();
  });

  it("processes a new event exactly once and marks it processed", async () => {
    const event = { id: "evt_2", type: "checkout.session.completed" };
    constructEventMock.mockReturnValue(event);

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));
    const json = await response.json();

    expect(json).toEqual({ received: true });
    expect(handleStripePaymentWebhookEventMock).toHaveBeenCalledTimes(1);
    expect(handleStripePaymentWebhookEventMock).toHaveBeenCalledWith(expect.anything(), event);
    expect(updateWebhookEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ processed_at: expect.any(String) }),
    );
  });

  it("returns 500 and does not mark the event processed when handling throws unexpectedly", async () => {
    constructEventMock.mockReturnValue({ id: "evt_3", type: "checkout.session.completed" });
    handleStripePaymentWebhookEventMock.mockRejectedValue(new Error("db unreachable"));

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(500);
    expect(updateWebhookEventMock).not.toHaveBeenCalled();
  });
});
