import { fireEvent, render, screen } from "@testing-library/react";
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

  it("closes on the Close button, Escape, and a backdrop click", () => {
    useApp.getState().setShortcutsOpen(true);
    const { rerender } = render(<ShortcutsDialog />);
    fireEvent.click(screen.getByText("Close"));
    expect(useApp.getState().shortcutsOpen).toBe(false);

    useApp.getState().setShortcutsOpen(true);
    rerender(<ShortcutsDialog />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().shortcutsOpen).toBe(false);

    useApp.getState().setShortcutsOpen(true);
    rerender(<ShortcutsDialog />);
    fireEvent.mouseDown(document.querySelector(".qz-overlay-backdrop")!);
    expect(useApp.getState().shortcutsOpen).toBe(false);
  });
});
