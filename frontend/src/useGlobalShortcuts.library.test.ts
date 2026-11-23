// Ctrl/⌘+B collapses and reopens the Library in both layouts
// (WORKSPACE_LAYOUT_PLAN D13), and leaves a text field's own Ctrl+B alone.
import { fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useApp } from "./store/useApp";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

beforeEach(() => useApp.setState({ leftCollapsed: false }));

describe("Ctrl+B toggles the Library", () => {
  it("collapses and reopens it, with Ctrl or Cmd, in either layout", () => {
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(useApp.getState().leftCollapsed).toBe(true);
    useApp.setState({ layoutMode: "windows" });
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(useApp.getState().leftCollapsed).toBe(false);
    useApp.setState({ layoutMode: "classic" });
  });

  it("does nothing while typing in a field, or with Shift held", () => {
    renderHook(() => useGlobalShortcuts());
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "b", ctrlKey: true });
    expect(useApp.getState().leftCollapsed).toBe(false);
    input.remove();
    fireEvent.keyDown(window, { key: "B", ctrlKey: true, shiftKey: true });
    expect(useApp.getState().leftCollapsed).toBe(false);
  });
});
