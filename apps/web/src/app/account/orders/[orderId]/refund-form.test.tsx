import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RefundForm } from "./refund-form";
import { issueRefundAction } from "./actions";

vi.mock("./actions", () => ({
  issueRefundAction: vi.fn(async () => ({})),
}));

/**
 * Issue #97 (risk:payment) regression test: the request idempotency token
 * must be minted ONCE per form instance, not freshly on every `onSubmit`.
 * A double-click/double-submit fired before `isPending` settles must send
 * the IDENTICAL `requestToken` both times, otherwise the server-side unique
 * index on `requestToken` never catches the duplicate.
 */
describe("RefundForm request idempotency", () => {
  it("submits the identical requestToken on a rapid double-submit before isPending settles", async () => {
    const { container } = render(<RefundForm orderId="order-1" remainingRefundableCents={1000} />);

    // Token is populated post-mount (see refund-form.tsx for why: avoiding an
    // SSR/client hydration mismatch).
    await waitFor(() => {
      const hiddenInput = container.querySelector('input[name="requestToken"]') as HTMLInputElement;
      expect(hiddenInput.value).not.toBe("");
    });

    const form = container.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => {
      expect(issueRefundAction).toHaveBeenCalledTimes(2);
    });

    const mock = vi.mocked(issueRefundAction);
    const [firstCall, secondCall] = mock.mock.calls;
    if (!firstCall || !secondCall) {
      throw new Error("Expected issueRefundAction to have been called twice");
    }
    const firstFormData = firstCall[1] as FormData;
    const secondFormData = secondCall[1] as FormData;

    const firstToken = firstFormData.get("requestToken");
    const secondToken = secondFormData.get("requestToken");

    expect(firstToken).not.toBe("");
    expect(firstToken).toBe(secondToken);
  });
});
