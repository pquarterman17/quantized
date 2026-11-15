// Audit-6 lane O: Origin keyboard habits in useGlobalShortcuts — Ctrl+R
// (rescale, never a page reload), Ctrl+N (new workbook), Ctrl+J (copy figure),
// F2 (rename the active dataset). Ctrl+Shift+S lives with the other Save tests
// in useGlobalShortcuts.test.ts; Ctrl+Q is worksheet-scoped (useGridCursor).
// Each habit must also stay inert while the user types in a field.

import { fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RENAME_ACTIVE_EVENT } from "./lib/renameActive";
import { useApp } from "./store/useApp";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

const copy = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("./lib/copyFigureCommand", () => ({ runCopyFigureCommand: copy }));

beforeEach(() => {
  copy.mockClear();
  useApp.setState({ datasets: [], xLim: [1, 2], yLim: [3, 4], y2Lim: null, viewHistory: [], viewFuture: [] });
});

/** Fire `init` at a focused text field; returns whether the browser default survived. */
function typing(init: KeyboardEventInit): boolean {
  const input = document.createElement("input");
  document.body.appendChild(input);
  const survived = fireEvent.keyDown(input, { ...init, cancelable: true });
  input.remove();
  return survived;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("Ctrl+R — rescale", () => {
  it("rescales the plot and is prevented, so the tab never reloads", async () => {
    renderHook(() => useGlobalShortcuts());
    expect(fireEvent.keyDown(window, { key: "r", ctrlKey: true, cancelable: true })).toBe(false);
    await vi.waitFor(() => expect(useApp.getState().xLim).toBeNull());
    expect(useApp.getState().yLim).toBeNull();
  });

  it("in a text field still blocks the reload but leaves the plot alone", () => {
    renderHook(() => useGlobalShortcuts());
    expect(typing({ key: "r", ctrlKey: true })).toBe(false);
    expect(useApp.getState().xLim).toEqual([1, 2]);
  });

  it("leaves Ctrl+Shift+R (hard reload) to the browser", () => {
    renderHook(() => useGlobalShortcuts());
    expect(fireEvent.keyDown(window, { key: "R", ctrlKey: true, shiftKey: true, cancelable: true })).toBe(true);
    expect(useApp.getState().xLim).toEqual([1, 2]);
  });
});

describe("Ctrl+N — new workbook", () => {
  it("adds a workbook", async () => {
    renderHook(() => useGlobalShortcuts());
    expect(fireEvent.keyDown(window, { key: "n", ctrlKey: true, cancelable: true })).toBe(false);
    await vi.waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
  });

  it("is inert while typing", async () => {
    renderHook(() => useGlobalShortcuts());
    expect(typing({ key: "n", ctrlKey: true })).toBe(true);
    await settle();
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  it("leaves Ctrl+Shift+N to the new-graph-window binding", async () => {
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "N", ctrlKey: true, shiftKey: true });
    await settle();
    expect(useApp.getState().datasets).toHaveLength(0);
  });
});

describe("Ctrl+J — copy figure", () => {
  it("copies the figure", async () => {
    renderHook(() => useGlobalShortcuts());
    expect(fireEvent.keyDown(window, { key: "j", ctrlKey: true, cancelable: true })).toBe(false);
    await settle();
    expect(copy).toHaveBeenCalledOnce();
  });

  it("is inert while typing", async () => {
    renderHook(() => useGlobalShortcuts());
    expect(typing({ key: "j", ctrlKey: true })).toBe(true);
    await settle();
    expect(copy).not.toHaveBeenCalled();
  });
});

describe("F2 — rename the active dataset", () => {
  it("asks the Library to rename", async () => {
    const onRename = vi.fn();
    window.addEventListener(RENAME_ACTIVE_EVENT, onRename);
    renderHook(() => useGlobalShortcuts());
    expect(fireEvent.keyDown(window, { key: "F2", cancelable: true })).toBe(false);
    await settle();
    expect(onRename).toHaveBeenCalledOnce();
    window.removeEventListener(RENAME_ACTIVE_EVENT, onRename);
  });

  it("is inert while typing and with Shift (the worksheet header editor)", async () => {
    const onRename = vi.fn();
    window.addEventListener(RENAME_ACTIVE_EVENT, onRename);
    renderHook(() => useGlobalShortcuts());
    expect(typing({ key: "F2" })).toBe(true);
    fireEvent.keyDown(window, { key: "F2", shiftKey: true });
    await settle();
    expect(onRename).not.toHaveBeenCalled();
    window.removeEventListener(RENAME_ACTIVE_EVENT, onRename);
  });
});
