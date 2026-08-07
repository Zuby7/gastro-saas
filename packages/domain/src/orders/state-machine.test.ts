import { describe, expect, it } from "vitest";
import {
  ORDER_STATUSES,
  assertValidOrderStatusTransition,
  isTerminalOrderStatus,
  isValidOrderStatusTransition,
  type OrderStatus,
} from "./state-machine";

describe("order status state machine", () => {
  it("allows creation only into awaiting_payment", () => {
    expect(isValidOrderStatusTransition(null, "awaiting_payment")).toBe(true);
    for (const status of ORDER_STATUSES) {
      if (status === "awaiting_payment") continue;
      expect(isValidOrderStatusTransition(null, status)).toBe(false);
    }
  });

  it("allows the full forward-only happy path", () => {
    const happyPath: OrderStatus[] = [
      "awaiting_payment",
      "received",
      "accepted",
      "preparing",
      "ready",
      "completed",
    ];
    for (let i = 0; i < happyPath.length - 1; i += 1) {
      const from = happyPath[i]!;
      const to = happyPath[i + 1]!;
      expect(isValidOrderStatusTransition(from, to)).toBe(true);
    }
  });

  it("allows cancellation from awaiting_payment, received, accepted, preparing", () => {
    for (const status of ["awaiting_payment", "received", "accepted", "preparing"] as const) {
      expect(isValidOrderStatusTransition(status, "cancelled")).toBe(true);
    }
  });

  it("rejects cancellation once an order is ready or completed", () => {
    expect(isValidOrderStatusTransition("ready", "cancelled")).toBe(false);
    expect(isValidOrderStatusTransition("completed", "cancelled")).toBe(false);
  });

  it("rejects skipping a step", () => {
    expect(isValidOrderStatusTransition("received", "completed")).toBe(false);
    expect(isValidOrderStatusTransition("awaiting_payment", "preparing")).toBe(false);
    expect(isValidOrderStatusTransition("accepted", "ready")).toBe(false);
  });

  it("rejects moving backwards", () => {
    expect(isValidOrderStatusTransition("ready", "received")).toBe(false);
    expect(isValidOrderStatusTransition("preparing", "accepted")).toBe(false);
    expect(isValidOrderStatusTransition("completed", "ready")).toBe(false);
  });

  it("rejects any transition out of a terminal state", () => {
    for (const status of ORDER_STATUSES) {
      if (!isTerminalOrderStatus(status)) continue;
      for (const target of ORDER_STATUSES) {
        expect(isValidOrderStatusTransition(status, target)).toBe(false);
      }
    }
  });

  it("rejects a no-op transition to the same status", () => {
    for (const status of ORDER_STATUSES) {
      expect(isValidOrderStatusTransition(status, status)).toBe(false);
    }
  });

  it("identifies completed/cancelled as terminal, everything else as non-terminal", () => {
    expect(isTerminalOrderStatus("completed")).toBe(true);
    expect(isTerminalOrderStatus("cancelled")).toBe(true);
    for (const status of ["awaiting_payment", "received", "accepted", "preparing", "ready"] as const) {
      expect(isTerminalOrderStatus(status)).toBe(false);
    }
  });

  it("assertValidOrderStatusTransition throws on an invalid transition and is silent on a valid one", () => {
    expect(() => assertValidOrderStatusTransition("ready", "received")).toThrow(
      /invalid order status transition/i,
    );
    expect(() => assertValidOrderStatusTransition("awaiting_payment", "received")).not.toThrow();
  });
});
