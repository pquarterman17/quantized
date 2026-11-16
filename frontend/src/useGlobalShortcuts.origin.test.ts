// Audit-6 lane O: Origin keyboard habits in useGlobalShortcuts — Ctrl+R
// (rescale, never a page reload), Ctrl+N (new workbook), Ctrl+J (copy figure),
// F2 (rename the selected/active dataset). Ctrl+Shift+S lives with the other
// Save tests in useGlobalShortcuts.test.ts; Ctrl+Q is worksheet-scoped
// (useGridCursor). Each habit must also stay inert while the user types.
// The lazy bodies are awaited with `vi.dynamicImportSettled()`, never a sleep.

import { fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { holdModal } from "./lib/appShortcuts";
import { RENAME_ACTIVE_EVENT } from "./lib/renameActive";
import { useApp } from "./store/useApp";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

const copy = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("./lib/copyFigureCommand", () => ({ runCopyFigureCommand: copy }));

beforeEach(() => {
  copy.mockClear();
  useApp.setState({ datasets: [], xLim: [1, 2], yLim: [3, 4], y2Lim: null, viewHistory: [], viewFuture: [], selectedIds: [], activeId: null, status: "" });
});

/** Fire `init` at a focused text field; returns whether the browser default survived. */
function typing(init: KeyboardEventInit, onKey?: (e: KeyboardEvent) => void): boolean {
  const input = document.createElement("input");
  if (onKey) input.addEventListener("keydown", onKey);
  document.body.appendChild(input);
  const survived = fireEvent.keyDown(input, { ...init, cancelable: true });
  input.remove();
  return survived;
}

describe("Ctrl+R — rescale, and never a reload", () => {
  it("rescales the plot and is prevented", () => {
    renderHook(() => useGlobalShortcuts());
    expect(fireEvent.keyDown(window, { key: "r", code: "KeyR", ctrlKey: true, cancelable: true })).toBe(false);
    expect(useApp.getState().xLim).toBeNull();
    expect(useApp.getState().yLim).toBeNull();
  });

  it("in a text field still blocks the reload but leaves the plot alone", () => {
    renderHook(() => useGlobalShortcuts());
    expect(typing({ key: "r", code: "KeyR", ctrlKey: true })).toBe(false);
    expect(useApp.getState().xLim).toEqual([1, 2]);
  });

  it("is blocked with Caps Lock on (key 'R') and on a non-Latin layout (key 'к')", () => {
    renderHook(() => useGlobalShortcuts());
    expect(typing({ key: "R", code: "KeyR", ctrlKey: true })).toBe(false);
    expect(typing({ key: "к", code: "KeyR", ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(window, { key: "r", code: "KeyR", metaKey: true, cancelable: true })).toBe(false);
  });

  it("is blocked under an open modal, which drops every other app shortcut", () => {
    renderHook(() => useGlobalShortcuts());
    const hold = {};
    holdModal(hold, true);
    try {
      expect(fireEvent.keyDown(window, { key: "r", code: "KeyR", ctrlKey: true, cancelable: true })).toBe(false);
      expect(useApp.getState().xLim).toEqual([1, 2]); // the gated rescale did not run
    } finally {
      holdModal(hold, false);
    }
  });

  it("is blocked inside a field that stops key propagation (palette, Set Column Values)", () => {
    renderHook(() => useGlobalShortcuts());
    expect(typing({ key: "r", code: "KeyR", ctrlKey: true }, (e) => e.stopPropagation())).toBe(false);
  });

  it("leaves Ctrl+Shift+R (hard reload) to the browser", () => {
    renderHook(() => useGlobalShortcuts());
    expect(fireEvent.keyDown(window, { key: "R", code: "KeyR", ctrlKey: true, shiftKey: true, cancelable: true })).toBe(true);
    expect(useApp.getState().xLim).toEqual([1, 2]);
  });
});

describe("Ctrl+N — new workbook", () => {
  it("adds a workbook through the palette command", async () => {
    renderHook(() => useGlobalShortcuts());
    expect(fireEvent.keyDown(window, { key: "n", ctrlKey: true, cancelable: true })).toBe(false);
    await vi.waitFor(() => expect(useApp.getState().datasets).toHaveLength(1));
  });

  it("is inert while typing", async () => {
    renderHook(() => useGlobalShortcuts());
    expect(typing({ key: "n", ctrlKey: true })).toBe(true);
    await vi.dynamicImportSettled();
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  it("leaves Ctrl+Shift+N to the new-graph-window binding", async () => {
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "N", ctrlKey: true, shiftKey: true });
    await vi.dynamicImportSettled();
    expect(useApp.getState().datasets).toHaveLength(0);
  });
});

describe("Ctrl+J — copy figure", () => {
  it("copies the figure through the palette command", async () => {
    renderHook(() => useGlobalShortcuts());
    expect(fireEvent.keyDown(window, { key: "j", ctrlKey: true, cancelable: true })).toBe(false);
    await vi.dynamicImportSettled();
    await vi.waitFor(() => expect(copy.mock.calls).toHaveLength(1));
  });

  it("is inert while typing", async () => {
    renderHook(() => useGlobalShortcuts());
    expect(typing({ key: "j", ctrlKey: true })).toBe(true);
    await vi.dynamicImportSettled();
    expect(copy.mock.calls).toHaveLength(0);
  });
});

describe("F2 — rename the selected (else active) dataset", () => {
  const listen = (claim: boolean) => {
    const asks: { id: string | null; hit: boolean }[] = [];
    const on = (ev: Event) => {
      const ask = (ev as CustomEvent<{ id: string | null; hit: boolean }>).detail;
      asks.push({ ...ask });
      if (claim) ask.hit = true;
    };
    window.addEventListener(RENAME_ACTIVE_EVENT, on);
    return { asks, off: () => window.removeEventListener(RENAME_ACTIVE_EVENT, on) };
  };

  it("names the single selected row, which can differ from the active (plotted) one", () => {
    useApp.setState({ activeId: "plotted", selectedIds: ["focused"] });
    const l = listen(true);
    renderHook(() => useGlobalShortcuts());
    expect(fireEvent.keyDown(window, { key: "F2", cancelable: true })).toBe(false);
    expect(l.asks).toEqual([{ id: "focused", hit: false }]);
    expect(useApp.getState().status).toBe("");
    l.off();
  });

  it("falls back to the active dataset when several or none are selected", () => {
    useApp.setState({ activeId: "plotted", selectedIds: ["a", "b"] });
    const l = listen(true);
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "F2" });
    expect(l.asks[0].id).toBe("plotted");
    l.off();
  });

  it("says so when no Library row claims it (Details view, search, collapsed panel)", () => {
    useApp.setState({ activeId: "plotted" });
    const l = listen(false);
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "F2" });
    expect(useApp.getState().status).toMatch(/F2.*Library/);
    l.off();
  });

  it("is inert while typing and with Shift (the worksheet header editor)", () => {
    const l = listen(true);
    renderHook(() => useGlobalShortcuts());
    expect(typing({ key: "F2" })).toBe(true);
    fireEvent.keyDown(window, { key: "F2", shiftKey: true });
    expect(l.asks).toEqual([]);
    l.off();
  });
});
