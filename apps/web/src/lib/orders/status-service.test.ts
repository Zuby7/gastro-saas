import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  InvalidOrderStatusTransitionError,
  OrderNotFoundError,
  transitionOrderStatus,
} from "./status-service";

function clientWith(result: { data: unknown; error: { message: string } | null }): SupabaseClient {
  return { rpc: async () => result } as unknown as SupabaseClient;
}

const input = {
  tenantId: "tenant-1",
  orderId: "3f1c2b6e-8a4d-4c1e-9b7a-2d5e6f7a8b9c",
  toStatus: "accepted" as const,
};

describe("transitionOrderStatus", () => {
  it("returns the new status on success", async () => {
    const supabase = clientWith({
      data: { orderId: input.orderId, status: "accepted" },
      error: null,
    });
    await expect(transitionOrderStatus(supabase, input)).resolves.toBe("accepted");
  });

  // Issue #204: the database's own error text must never become the
  // user-facing message.
  it("maps an invalid transition to the default German message, not the raw database text", async () => {
    const supabase = clientWith({
      data: null,
      error: { message: "Invalid order status transition: completed -> accepted (order 3f1c)" },
    });

    const error = await transitionOrderStatus(supabase, input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidOrderStatusTransitionError);
    expect((error as Error).message).toBe("Dieser Statuswechsel ist nicht zulässig.");
  });

  it("maps a missing order to OrderNotFoundError with its default message", async () => {
    const supabase = clientWith({ data: null, error: { message: "Order not found" } });

    const error = await transitionOrderStatus(supabase, input).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OrderNotFoundError);
    expect((error as Error).message).toBe("Diese Bestellung wurde nicht gefunden.");
  });

  it("rethrows any other database error for the caller to translate", async () => {
    const dbError = { message: "connection terminated" };
    const supabase = clientWith({ data: null, error: dbError });
    await expect(transitionOrderStatus(supabase, input)).rejects.toBe(dbError);
  });
});
