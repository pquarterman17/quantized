import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import ShortcutsDialog from "./ShortcutsDialog";
import { useApp } from "../../store/useApp";

describe("ShortcutsDialog", () => {
  beforeEach(() => useApp.getState().setShortcutsOpen(false));

  it("renders nothing when closed", () => {
    const { container } = render(<ShortcutsDialog />);
    expect(container.querySelector(".qzk-shortcuts")).toBeNull();
  });

  it("shows the groups + rows when open", () => {
    useApp.getState().setShortcutsOpen(true);
    render(<ShortcutsDialog />);
    expect(screen.getByText("Keyboard & mouse shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Open the command palette")).toBeInTheDocument();
    // At least one <kbd> chip is present.
    expect(document.querySelector(".qzk-kbd")).toBeInTheDocument();
  });

  it("closes on the Close button, Escape, and a backdrop click", async () => {
    useApp.getState().setShortcutsOpen(true);
    const { rerender } = render(<ShortcutsDialog />);
    fireEvent.click(screen.getByText("Close"));
    expect(useApp.getState().shortcutsOpen).toBe(false);

    useApp.getState().setShortcutsOpen(true);
    rerender(<ShortcutsDialog />);
    fireEvent.keyDown(window, { key: "Escape" });
    // Escape now goes through the ordered registry (`lib/escapeStack.ts`,
    // BUG-018), whose walk is deferred one macrotask, so wait on the STATE the
    // close produces rather than reading it in the same tick.
    await waitFor(() => expect(useApp.getState().shortcutsOpen).toBe(false));

    useApp.getState().setShortcutsOpen(true);
    rerender(<ShortcutsDialog />);
    fireEvent.mouseDown(document.querySelector(".qz-overlay-backdrop")!);
    expect(useApp.getState().shortcutsOpen).toBe(false);
  });
});

// R1 (P3.3): this dialog's Escape was reachable via window-capture even
// without focus ever moving in — but nothing moved focus IN, trapped Tab, or
// restored it on close. Driven via userEvent at document.activeElement (not
// fireEvent.keyDown on the box), which is what actually exercises the gap.
describe("ShortcutsDialog focus-in / Escape / restore (P3.3 R1)", () => {
  beforeEach(() => useApp.getState().setShortcutsOpen(false));

  it("moves focus into the dialog on open, onto the Close button", () => {
    useApp.getState().setShortcutsOpen(true);
    render(<ShortcutsDialog />);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("Escape (via the keyboard, not fireEvent on the box) closes it and gives focus back to the opener", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">opener</button>
        <ShortcutsDialog />
      </>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();

    act(() => useApp.getState().setShortcutsOpen(true));
    expect(opener).not.toHaveFocus();

    await user.keyboard("{Escape}");
    expect(useApp.getState().shortcutsOpen).toBe(false);
    expect(opener).toHaveFocus();
  });
});
