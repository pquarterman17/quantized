import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ConfirmDialog, { askConfirm } from "./ConfirmDialog";

/** Open the dialog inside act() so its state update + effect (key listener) flush. */
function open(...args: Parameters<typeof askConfirm>): Promise<boolean> {
  let p!: Promise<boolean>;
  act(() => {
    p = askConfirm(...args);
  });
  return p;
}

describe("ConfirmDialog / askConfirm", () => {
  it("renders nothing until asked", () => {
    const { container } = render(<ConfirmDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows title + message and resolves true when the confirm button is clicked", async () => {
    render(<ConfirmDialog />);
    const result = open("Remove everything?", "gone forever", "Remove all", true);
    expect(screen.getByText("Remove everything?")).toBeInTheDocument();
    expect(screen.getByText("gone forever")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    await expect(result).resolves.toBe(true);
    expect(screen.queryByText("Remove everything?")).not.toBeInTheDocument(); // closed
  });

  it("resolves false on Cancel", async () => {
    render(<ConfirmDialog />);
    const result = open("Sure?");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(result).resolves.toBe(false);
  });

  it("resolves false on Escape and true on Enter", async () => {
    render(<ConfirmDialog />);
    const cancelled = open("Sure?");
    fireEvent.keyDown(window, { key: "Escape" });
    await expect(cancelled).resolves.toBe(false);

    const confirmed = open("Sure?");
    fireEvent.keyDown(window, { key: "Enter" });
    await expect(confirmed).resolves.toBe(true);
  });

  it("resolves false when the backdrop is clicked", async () => {
    const { container } = render(<ConfirmDialog />);
    const result = open("Sure?");
    fireEvent.mouseDown(container.querySelector(".qz-overlay-backdrop")!);
    await expect(result).resolves.toBe(false);
  });
});
