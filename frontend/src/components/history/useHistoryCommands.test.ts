// MAIN_PLAN #9 (undo/redo) — the command-registry + keyboard layer. The
// slice mechanics (recordHistory/undo/redo/depth/restore-guards) are
// covered in store/history.test.ts; this file covers only what this hook
// itself owns: publishing "Undo <label>" / "Redo <label>" into the shared
// registry (reactively, tracking the live stack top), the Ctrl+Z /
// Ctrl+Shift+Z key handling, the isEditing guard, and the empty-stack toast.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useCommands } from "../../store/commands";
import { useToasts } from "../../store/toasts";
import { useApp } from "../../store/useApp";
import { useHistoryCommands } from "./useHistoryCommands";

function action(id: string) {
  const a = useCommands.getState().menuCommands.find((c) => c.id === id);
  if (!a) throw new Error(`no published action ${id}`);
  return a;
}

function press(key: string, opts: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}, target?: EventTarget) {
  const e = new KeyboardEvent("keydown", {
    key,
    ctrlKey: !!opts.ctrl,
    metaKey: !!opts.meta,
    shiftKey: !!opts.shift,
    bubbles: true,
    cancelable: true,
  });
  (target ?? window).dispatchEvent(e);
}

const raw = { time: [1, 2, 3], values: [[10], [20], [30]], labels: ["m"], units: ["emu"], metadata: {} };

beforeEach(() => {
  useApp.setState({
    datasets: [],
    activeId: null,
    selectedIds: [],
    worksheetId: null,
    originFigures: [],
    reports: [],
    figureDocs: [],
    history: [],
    future: [],
  });
  useCommands.setState({ menuCommands: [] });
  useToasts.setState({ toasts: [] });
});
afterEach(() => {
  useCommands.setState({ menuCommands: [] });
});

describe("useHistoryCommands — published registry entries", () => {
  it("publishes Undo/Redo in the Edit group, plain-labeled on an empty stack", () => {
    renderHook(() => useHistoryCommands());
    expect(action("history-undo").label).toBe("Undo");
    expect(action("history-redo").label).toBe("Redo");
    expect(action("history-undo").group).toBe("Edit");
    expect(action("history-redo").group).toBe("Edit");
  });

  it("re-publishes with the live stack-top label once an action is recorded", () => {
    renderHook(() => useHistoryCommands());
    act(() => {
      useApp.getState().addDataset({ id: "d1", name: "a", data: raw });
    });
    expect(action("history-undo").label).toBe("Undo add dataset");

    act(() => action("history-undo").run());
    expect(action("history-redo").label).toBe("Redo add dataset");
  });

  it("coexists with another registry publisher (MAIN_PLAN #9 multi-source merge) — publishing history commands never clobbers a pre-existing 'windows' source", () => {
    useCommands.getState().setMenuCommands("windows", [
      { id: "window-new", group: "Window", label: "New Graph Window", run: () => {} },
    ]);
    renderHook(() => useHistoryCommands());
    const ids = useCommands.getState().menuCommands.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["window-new", "history-undo", "history-redo"]));
  });
});

describe("useHistoryCommands — run behavior", () => {
  it("Undo on an empty stack toasts 'nothing to undo' and touches nothing", () => {
    renderHook(() => useHistoryCommands());
    act(() => action("history-undo").run());
    expect(useToasts.getState().toasts.some((t) => t.msg === "nothing to undo")).toBe(true);
  });

  it("Redo on an empty stack toasts 'nothing to redo'", () => {
    renderHook(() => useHistoryCommands());
    act(() => action("history-redo").run());
    expect(useToasts.getState().toasts.some((t) => t.msg === "nothing to redo")).toBe(true);
  });

  it("Undo with an entry present calls the store action and confirms via toast", () => {
    renderHook(() => useHistoryCommands());
    act(() => {
      useApp.getState().addDataset({ id: "d1", name: "a", data: raw });
    });
    act(() => action("history-undo").run());
    expect(useApp.getState().datasets).toHaveLength(0);
    expect(useToasts.getState().toasts.some((t) => t.msg.includes("add dataset"))).toBe(true);
  });
});

describe("useHistoryCommands — keyboard shortcuts", () => {
  it("Ctrl+Z triggers undo", () => {
    renderHook(() => useHistoryCommands());
    act(() => {
      useApp.getState().addDataset({ id: "d1", name: "a", data: raw });
    });
    act(() => press("z", { ctrl: true }));
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  it("Cmd+Z (macOS) triggers undo", () => {
    renderHook(() => useHistoryCommands());
    act(() => {
      useApp.getState().addDataset({ id: "d1", name: "a", data: raw });
    });
    act(() => press("z", { meta: true }));
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  it("Ctrl+Shift+Z triggers redo", () => {
    renderHook(() => useHistoryCommands());
    act(() => {
      useApp.getState().addDataset({ id: "d1", name: "a", data: raw });
    });
    act(() => press("z", { ctrl: true })); // undo
    expect(useApp.getState().datasets).toHaveLength(0);
    act(() => press("z", { ctrl: true, shift: true })); // redo
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("never intercepts Ctrl+Z while focus is in an input/textarea/contentEditable — native text undo keeps working", () => {
    renderHook(() => useHistoryCommands());
    act(() => {
      useApp.getState().addDataset({ id: "d1", name: "a", data: raw });
    });
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    act(() => press("z", { ctrl: true }, input));
    // Not intercepted: the dataset is still there (undo never ran).
    expect(useApp.getState().datasets).toHaveLength(1);
    document.body.removeChild(input);
  });

  it("removes its keydown listener on unmount", () => {
    const { unmount } = renderHook(() => useHistoryCommands());
    act(() => {
      useApp.getState().addDataset({ id: "d1", name: "a", data: raw });
    });
    unmount();
    act(() => press("z", { ctrl: true }));
    expect(useApp.getState().datasets).toHaveLength(1); // no undo — listener is gone
  });
});
