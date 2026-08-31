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
  // GUI_INTERACTION #17 — destructive actions are visually separated.
  it("separates a DESTRUCTIVE confirm from Cancel", async () => {
    const { container } = render(<ConfirmDialog />);
    const result = open("Delete it?", "gone forever", "Delete", true);
    expect(container.querySelector(".qz-btn-row--danger")).not.toBeNull();
    expect(screen.getByTestId("destructive-gap")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await expect(result).resolves.toBe(false);
  });

  it("does NOT separate a non-destructive confirm (ordinary primary row)", async () => {
    const { container } = render(<ConfirmDialog />);
    const result = open("Proceed?", "", "OK");
    expect(container.querySelector(".qz-btn-row")).not.toBeNull();
    expect(container.querySelector(".qz-btn-row--danger")).toBeNull();
    expect(screen.queryByTestId("destructive-gap")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    await expect(result).resolves.toBe(false);
  });
});

describe("safety for irreversible confirms (P3.5 review)", () => {
  it("ignores an auto-REPEAT Enter, so a held key cannot confirm blind", async () => {
    // The key listener mounts in an effect AFTER the dialog renders. A user
    // who opened this by holding Enter on the triggering button would have the
    // next auto-repeat land here as a confirm, before reading the question —
    // on a delete that cannot be undone, the whole safeguard bypassed.
    const answer = askConfirm("Delete it?", "This cannot be undone.", "Delete", true);
    render(<ConfirmDialog />);
    await screen.findByText("Delete it?");

    fireEvent.keyDown(window, { key: "Enter", repeat: true });
    expect(screen.getByText("Delete it?")).toBeInTheDocument(); // still open

    fireEvent.keyDown(window, { key: "Enter" }); // a deliberate press still works
    expect(await answer).toBe(true);
  });

  it("announces itself as a dialog and moves focus to the SAFE button", async () => {
    // Without a role the backdrop is just a div, and focus stays on the button
    // behind it — a screen-reader user is never taken to the question.
    const answer = askConfirm("Delete it?", "This cannot be undone.", "Delete", true);
    render(<ConfirmDialog />);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Delete it?");
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
    // Cancel, not the destructive button: a stray Space/Enter must dismiss.
    expect(document.activeElement).toHaveTextContent("Cancel");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(await answer).toBe(false);
  });
});
