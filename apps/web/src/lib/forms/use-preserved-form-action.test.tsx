import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePreservedFormAction } from "./use-preserved-form-action";

type State = { error?: string; fieldErrors?: Record<string, string> };

function Harness({
  action,
  resetOnSuccess,
}: {
  action: (prev: State, fd: FormData) => Promise<State>;
  resetOnSuccess?: boolean;
}) {
  const [state, formProps, isPending] = usePreservedFormAction(
    action,
    {} as State,
    resetOnSuccess === undefined ? {} : { resetOnSuccess },
  );
  return (
    <form {...formProps} aria-label="demo">
      <label>
        Name
        <input name="name" type="text" />
      </label>
      <label>
        Agree
        <input name="agree" type="checkbox" />
      </label>
      <label>
        Kind
        <select name="kind" defaultValue="a">
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
      </label>
      <label>
        Note
        <textarea name="note" />
      </label>
      <button type="submit" disabled={isPending}>
        Go
      </button>
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}

function fill() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada" } });
  fireEvent.click(screen.getByLabelText("Agree"));
  fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "b" } });
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: "hello" } });
}

describe("usePreservedFormAction", () => {
  it("renders a form with a function action (never a bare GET form) and keeps values", async () => {
    const action = vi.fn(async () => ({ error: "x" }));
    render(<Harness action={action} />);
    const form = screen.getByRole("form", { name: "demo" });
    expect(form.getAttribute("action")).toMatch(/^javascript:/);
    expect(form.getAttribute("method")?.toLowerCase() ?? "post").not.toBe("get");
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await screen.findByRole("alert");
    // action present + onSubmit preventDefault: React must not auto-reset.
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("clears only the clearOnError fields after an error", async () => {
    function Pw() {
      const [, formProps] = usePreservedFormAction(
        async () => ({ error: "bad" }) as State,
        {} as State,
        {
          clearOnError: ["pw"],
        },
      );
      return (
        <form {...formProps} aria-label="pw-form">
          <input aria-label="mail" name="mail" />
          <input aria-label="pw" name="pw" type="password" />
          <button type="submit">Go</button>
        </form>
      );
    }
    render(<Pw />);
    fireEvent.change(screen.getByLabelText("mail"), { target: { value: "a@b.de" } });
    fireEvent.change(screen.getByLabelText("pw"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(screen.getByLabelText("pw")).toHaveValue(""));
    expect(screen.getByLabelText("mail")).toHaveValue("a@b.de");
  });

  it("keeps all field values (text, checkbox, select, textarea) after an error result", async () => {
    const action = vi.fn(async () => ({ error: "Bitte prüfen" }));
    render(<Harness action={action} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Bitte prüfen");
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
    expect(screen.getByLabelText("Agree")).toBeChecked();
    expect(screen.getByLabelText("Kind")).toHaveValue("b");
    expect(screen.getByLabelText("Note")).toHaveValue("hello");
  });

  it("keeps values when only fieldErrors are returned", async () => {
    const action = vi.fn(async () => ({ fieldErrors: { name: "x" } }));
    render(<Harness action={action} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Go" })).toBeEnabled());
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
  });

  it("passes the submitted FormData to the action", async () => {
    const action = vi.fn(async (_prev: State, _fd: FormData) => ({}) as State);
    render(<Harness action={action} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const fd = action.mock.calls[0]![1];
    expect(fd.get("name")).toBe("Ada");
    expect(fd.get("agree")).toBe("on");
    expect(fd.get("kind")).toBe("b");
    expect(fd.get("note")).toBe("hello");
  });

  it("resets the form after a successful result", async () => {
    const action = vi.fn(async () => ({}) as State);
    render(<Harness action={action} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(""));
    expect(screen.getByLabelText("Agree")).not.toBeChecked();
    expect(screen.getByLabelText("Kind")).toHaveValue("a");
  });

  it("does not reset after success when resetOnSuccess is false", async () => {
    const action = vi.fn(async () => ({}) as State);
    render(<Harness action={action} resetOnSuccess={false} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => expect(action).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Go" })).toBeEnabled());
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
  });

  it("keeps values after an error and clears them once a later submit succeeds", async () => {
    const action = vi
      .fn<(prev: State, fd: FormData) => Promise<State>>()
      .mockResolvedValueOnce({ error: "nope" })
      .mockResolvedValueOnce({});
    render(<Harness action={action} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");

    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue(""));
  });
});
