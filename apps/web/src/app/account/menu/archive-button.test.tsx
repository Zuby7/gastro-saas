import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ArchiveButton } from "./archive-button";

describe("ArchiveButton", () => {
  it("does not submit on the first click and asks for confirmation", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ArchiveButton itemLabel="Pizza" />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pizza archivieren" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pizza wirklich archivieren" })).toHaveTextContent(
      "Wirklich archivieren?",
    );
  });

  it("submits only on the confirming click, and cancel returns to the first step", () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ArchiveButton itemLabel="Pizza" />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pizza archivieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.getByRole("button", { name: "Pizza archivieren" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pizza archivieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Pizza wirklich archivieren" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
