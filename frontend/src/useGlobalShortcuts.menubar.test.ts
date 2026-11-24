// Alt+letter / F10 menu-bar access (UX menus N13; provisional, owner to confirm) and the Ctrl+Y / Ctrl+Shift+Z
// redo pair (N18: Ctrl+Y was already bound by useHistoryCommands, pinned there). The hook only dispatches
// MENUBAR_ACCESS_EVENT; MenuBar owns the opening.

import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MENUBAR_ACCESS_EVENT, MENUBAR_MNEMONICS } from "./lib/menubarAccess";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

function listen() {
  const seen: Array<string | undefined> = [];
  const on = (e: Event) => seen.push((e as CustomEvent<{ label?: string }>).detail.label);
  window.addEventListener(MENUBAR_ACCESS_EVENT, on);
  return { seen, off: () => window.removeEventListener(MENUBAR_ACCESS_EVENT, on) };
}

describe("useGlobalShortcuts: menu-bar access", () => {
  let off = () => {};
  afterEach(() => off());

  it("Alt+F opens File, Alt+W Window, F10 focuses the bar", () => {
    const l = listen();
    off = l.off;
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "f", altKey: true });
    fireEvent.keyDown(window, { key: "W", altKey: true });
    fireEvent.keyDown(window, { key: "F10" });
    expect(l.seen).toEqual(["File", "Window", undefined]);
  });

  it("every menu has a unique mnemonic", () => {
    expect(new Set(Object.values(MENUBAR_MNEMONICS)).size).toBe(10);
  });

  it("ignores Alt+Shift, Ctrl+Alt (AltGr) and Shift+F10 (the context-menu key)", () => {
    const l = listen();
    off = l.off;
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "f", altKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "f", altKey: true, ctrlKey: true });
    fireEvent.keyDown(window, { key: "F10", shiftKey: true });
    expect(l.seen).toEqual([]);
  });

  it("does not hijack Alt+arrow view history", () => {
    const l = listen();
    off = l.off;
    renderHook(() => useGlobalShortcuts());
    const spy = vi.fn();
    window.addEventListener("keydown", spy);
    fireEvent.keyDown(window, { key: "ArrowLeft", altKey: true });
    window.removeEventListener("keydown", spy);
    expect(l.seen).toEqual([]);
  });
});
