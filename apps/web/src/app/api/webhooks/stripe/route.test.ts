import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const constructEventMock = vi.fn();
const claimEventMock = vi.fn();
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
    rpc: (fn: string, args: unknown) => {
      if (fn === "claim_payment_webhook_event") return claimEventMock(args);
      throw new Error(`unexpected rpc ${fn}`);
    },
    from: (table: string) => {
      if (table === "payment_webhook_events") {
        return {
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
  claimEventMock.mockResolvedValue({ data: [{ already_processed: false }], error: null });
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
    expect(claimEventMock).not.toHaveBeenCalled();
    expect(handleStripePaymentWebhookEventMock).not.toHaveBeenCalled();
  });

  it("verifies against the raw request body text, not a re-parsed/re-serialized body", async () => {
    constructEventMock.mockReturnValue({ id: "evt_1", type: "checkout.session.completed" });
    const rawBody = '{"raw":   "spacing preserved"}';

    const { POST } = await import("./route");
    await POST(makeRequest(rawBody));

    expect(constructEventMock).toHaveBeenCalledWith(rawBody, "sig_test", "whsec_test");
  });

  it("deduplicates a genuinely already-processed event and never calls the processing logic", async () => {
    constructEventMock.mockReturnValue({ id: "evt_1", type: "checkout.session.completed" });
    claimEventMock.mockResolvedValue({ data: [{ already_processed: true }], error: null });

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

  it("claim RPC failure is a hard error (never silently swallowed)", async () => {
    constructEventMock.mockReturnValue({ id: "evt_claim_error", type: "checkout.session.completed" });
    claimEventMock.mockResolvedValue({ data: null, error: { message: "db error" } });

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));

    expect(response.status).toBe(500);
    expect(handleStripePaymentWebhookEventMock).not.toHaveBeenCalled();
  });

  // Regression test for the epic-7 batch review finding: the payment webhook
  // had the identical dedup/retry contradiction just fixed on
  // `stripe-connect/route.ts` -- a plain unique-violation-means-duplicate
  // dedup check made a claimed-but-never-completed row permanently
  // unreclaimable by Stripe's own retry of the same event id, silently and
  // permanently losing a webhook's effect (money captured, order stuck in
  // `awaiting_payment` forever) on any mid-processing failure.
  // `claim_payment_webhook_event()` fixes this by only reporting
  // `already_processed: true` once processing genuinely finished (the DB-level
  // claim/reclaim semantics are covered by the migration/integration test;
  // this proves the route's own reprocess-vs-duplicate branching).
  describe("retry semantics (epic-7 batch review fix)", () => {
    it("first delivery: processing throws -> 500, event left reclaimable (processed_at update never called)", async () => {
      constructEventMock.mockReturnValue({ id: "evt_retry", type: "checkout.session.completed" });
      handleStripePaymentWebhookEventMock.mockRejectedValueOnce(new Error("transient db blip"));

      const { POST } = await import("./route");
      const response = await POST(makeRequest("{}"));

      expect(response.status).toBe(500);
      expect(handleStripePaymentWebhookEventMock).toHaveBeenCalledTimes(1);
      expect(updateWebhookEventMock).not.toHaveBeenCalled();
    });

    it("second delivery of the SAME event id (still unprocessed) is genuinely reprocessed and this time succeeds", async () => {
      const event = { id: "evt_retry", type: "checkout.session.completed" };
      constructEventMock.mockReturnValue(event);
      // Claim RPC reports not-yet-processed (the DB row was claimed but never
      // reached processed_at after the first failure) -- this delivery's
      // processing succeeds.
      claimEventMock.mockResolvedValue({ data: [{ already_processed: false }], error: null });
      handleStripePaymentWebhookEventMock.mockResolvedValueOnce(undefined);

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

    it("third delivery of an already-successfully-processed event is a true no-op duplicate", async () => {
      constructEventMock.mockReturnValue({ id: "evt_retry", type: "checkout.session.completed" });
      claimEventMock.mockResolvedValue({ data: [{ already_processed: true }], error: null });

      const { POST } = await import("./route");
      const response = await POST(makeRequest("{}"));
      const json = await response.json();

      expect(json).toEqual({ received: true, duplicate: true });
      expect(handleStripePaymentWebhookEventMock).not.toHaveBeenCalled();
    });
  });
});
