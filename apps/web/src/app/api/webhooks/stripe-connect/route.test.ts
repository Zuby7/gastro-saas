import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const constructEventMock = vi.fn();
const claimEventMock = vi.fn();
const applySnapshotMock = vi.fn();
const updateWebhookEventMock = vi.fn();

vi.mock("@/lib/stripe/client", () => ({
  createStripeClient: () => ({
    webhooks: { constructEvent: constructEventMock },
  }),
  getStripeConnectWebhookSecret: () => "whsec_test",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: (fn: string, args: unknown) => {
      if (fn === "claim_payment_webhook_event") return claimEventMock(args);
      if (fn === "apply_connect_account_snapshot") return applySnapshotMock(args);
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
  return new NextRequest("http://localhost/api/webhooks/stripe-connect", {
    method: "POST",
    body,
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  claimEventMock.mockResolvedValue({ data: [{ already_processed: false }], error: null });
  applySnapshotMock.mockResolvedValue({ data: null, error: null });
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
    expect(claimEventMock).not.toHaveBeenCalled();
  });

  it("deduplicates a genuinely already-processed event and does not reprocess it", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_1",
      type: "account.updated",
      account: "acct_1",
      created: 1_700_000_000,
    });
    claimEventMock.mockResolvedValue({ data: [{ already_processed: true }], error: null });

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));
    const json = await response.json();

    expect(json).toEqual({ received: true, duplicate: true });
    expect(applySnapshotMock).not.toHaveBeenCalled();
  });

  it("updates payment_accounts on a verified account.updated event", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_2",
      type: "account.updated",
      account: "acct_1",
      created: 1_700_000_000,
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
    expect(applySnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({
        p_stripe_account_id: "acct_1",
        p_event_at: new Date(1_700_000_000 * 1000).toISOString(),
        p_status: "enabled",
        p_charges_enabled: true,
        p_payouts_enabled: true,
      }),
    );
    expect(updateWebhookEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ processed_at: expect.any(String) }),
    );
  });

  it("ignores unrelated event types but still dedups/acknowledges them", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_3",
      type: "account.application.deauthorized",
      created: 1_700_000_000,
    });

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));
    const json = await response.json();

    expect(json).toEqual({ received: true });
    expect(applySnapshotMock).not.toHaveBeenCalled();
  });

  it("claim RPC failure is a hard error (never silently swallowed)", async () => {
    constructEventMock.mockReturnValue({ id: "evt_4", type: "account.updated", created: 1 });
    claimEventMock.mockResolvedValue({ data: null, error: { message: "db error" } });

    const { POST } = await import("./route");
    const response = await POST(makeRequest("{}"));
    expect(response.status).toBe(500);
    expect(applySnapshotMock).not.toHaveBeenCalled();
  });

  // Regression test for the epic-7 batch review finding: a plain
  // unique-violation-means-duplicate dedup check made a claimed-but-never-
  // completed row permanently unreclaimable by Stripe's own retry of the
  // same event id. `claim_payment_webhook_event()` fixes this by only
  // reporting `already_processed: true` once processing genuinely finished
  // (the DB-level claim/reclaim semantics are covered by the integration
  // test; this proves the route's own reprocess-vs-duplicate branching).
  describe("retry semantics (epic-7 batch review fix)", () => {
    it("first delivery: processing throws -> 500, event left reclaimable (processed_at update never called)", async () => {
      constructEventMock.mockReturnValue({
        id: "evt_retry",
        type: "account.updated",
        account: "acct_1",
        created: 1_700_000_000,
        data: { object: { id: "acct_1", charges_enabled: true, payouts_enabled: true } },
      });
      applySnapshotMock.mockRejectedValueOnce(new Error("transient db blip"));

      const { POST } = await import("./route");
      const response = await POST(makeRequest("{}"));

      expect(response.status).toBe(500);
      expect(updateWebhookEventMock).not.toHaveBeenCalled();
    });

    it("second delivery of the SAME event id (still unprocessed) is genuinely reprocessed", async () => {
      const event = {
        id: "evt_retry",
        type: "account.updated",
        account: "acct_1",
        created: 1_700_000_000,
        data: { object: { id: "acct_1", charges_enabled: true, payouts_enabled: true } },
      };
      constructEventMock.mockReturnValue(event);
      // Claim RPC reports not-yet-processed both times (the DB row was
      // claimed but never reached processed_at after the first failure).
      claimEventMock.mockResolvedValue({ data: [{ already_processed: false }], error: null });

      const { POST } = await import("./route");
      const response = await POST(makeRequest("{}"));
      const json = await response.json();

      expect(json).toEqual({ received: true });
      expect(applySnapshotMock).toHaveBeenCalledTimes(1);
      expect(updateWebhookEventMock).toHaveBeenCalledWith(
        expect.objectContaining({ processed_at: expect.any(String) }),
      );
    });

    it("third delivery of an already-successfully-processed event is a true no-op duplicate", async () => {
      constructEventMock.mockReturnValue({
        id: "evt_retry",
        type: "account.updated",
        account: "acct_1",
        created: 1_700_000_000,
      });
      claimEventMock.mockResolvedValue({ data: [{ already_processed: true }], error: null });

      const { POST } = await import("./route");
      const response = await POST(makeRequest("{}"));
      const json = await response.json();

      expect(json).toEqual({ received: true, duplicate: true });
      expect(applySnapshotMock).not.toHaveBeenCalled();
    });
  });
});
