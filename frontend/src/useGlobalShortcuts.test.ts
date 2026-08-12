// GUI_INTERACTION #9 (active-tool feedback + universal Esc-cancel): the
// centralized Escape composition in useGlobalShortcuts — cancel a live
// gesture first (lib/gestureCancel), then an idle-armed qfit gadget, and
// only then revert the active plot tool to Pointer (unless Preferences ▸
// Interaction ▸ "Persistent plot tool" is on, or the user is typing in a
// field). Same renderHook/fireEvent convention as useShapeDraw.test.ts;
// jsdom can't drive a real uPlot drag, so a live gesture is simulated by
// registering a canceller directly through lib/gestureCancel, exactly as
// the uPlot plugins do at mousedown.

import { fireEvent, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setActiveGestureCancel } from "./lib/gestureCancel";
import { saveInteractionPrefs } from "./store/prefs";
import { useApp } from "./store/useApp";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

beforeEach(() => {
  localStorage.removeItem("qz.interactionPrefs");
  setActiveGestureCancel(null);
  useApp.setState({
    plotTool: "fwhm",
    qfitRoi: null,
    gadgetCursors: null,
    datasets: [],
    confirmRemove: false,
  });
});

describe("useGlobalShortcuts — Esc: live gesture wins first", () => {
  it("cancels a registered gesture instead of reverting the tool", () => {
    const cancel = vi.fn();
    setActiveGestureCancel(cancel);
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancel).toHaveBeenCalledOnce();
    // The gesture-cancel consumed this Escape — the tool that was mid-drag
    // stays armed so the user can immediately retry.
    expect(useApp.getState().plotTool).toBe("fwhm");
  });

  it("clears the registration so a second Escape falls through to the next tier", () => {
    const cancel = vi.fn();
    setActiveGestureCancel(cancel);
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancel).toHaveBeenCalledOnce(); // not called again
    expect(useApp.getState().plotTool).toBe("pointer"); // 2nd Esc reverted
  });
});

describe("useGlobalShortcuts — Esc: idle-armed qfit gadget", () => {
  it("clears a committed roi with no drag in progress (no tool revert yet)", () => {
    useApp.setState({ plotTool: "qfit", qfitRoi: [1, 2] });
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().qfitRoi).toBeNull();
    expect(useApp.getState().plotTool).toBe("qfit"); // stays armed for a retry
  });

  it("clears committed cursors the same way", () => {
    useApp.setState({ plotTool: "qfit", gadgetCursors: [1, 3] });
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().gadgetCursors).toBeNull();
  });
});

describe("useGlobalShortcuts — Esc: no gesture in progress reverts to Pointer", () => {
  it("reverts a non-pointer tool to pointer", () => {
    useApp.setState({ plotTool: "measure" });
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().plotTool).toBe("pointer");
  });

  it("is a no-op when already on pointer", () => {
    useApp.setState({ plotTool: "pointer" });
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().plotTool).toBe("pointer");
  });

  it("does not revert while typing in a field", () => {
    useApp.setState({ plotTool: "stats" });
    renderHook(() => useGlobalShortcuts());
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useApp.getState().plotTool).toBe("stats");
    document.body.removeChild(input);
  });
});

describe("useGlobalShortcuts — persistentTool preference", () => {
  it("keeps the tool armed on Esc when set", () => {
    saveInteractionPrefs({ persistentTool: true });
    useApp.setState({ plotTool: "integ" });
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().plotTool).toBe("integ");
  });

  it("still cancels a live gesture when set (only the tool-revert is skipped)", () => {
    saveInteractionPrefs({ persistentTool: true });
    const cancel = vi.fn();
    setActiveGestureCancel(cancel);
    useApp.setState({ plotTool: "integ" });
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(useApp.getState().plotTool).toBe("integ");
  });

  it("defaults OFF — a fresh install still reverts to pointer", () => {
    useApp.setState({ plotTool: "select" });
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useApp.getState().plotTool).toBe("pointer");
  });
});

// Reported from a real session: "trouble hitting delete of the box and I
// ended up deleting the dataset". This window listener fires on the way out
// of every element handler, and `preventDefault()` does not stop propagation
// — so a component that deleted its own focused object (map ROI box, cut
// ruler, worksheet block, Figure Page slot: all four preventDefault) had the
// same keystroke continue on to here and remove the DATASET too. With
// `confirmRemove` false by default there was no prompt, and `mapRoi` is
// excluded from undo, so nothing to undo either.
describe("useGlobalShortcuts — Delete does not steal a consumed keystroke", () => {
  const withDataset = () =>
    useApp.setState({
      datasets: [{ id: "d1", name: "scan.dat", data: { time: [0], values: [[1]], labels: ["A"], units: [""], metadata: {} } }],
      activeId: "d1",
      selectedIds: ["d1"],
      confirmRemove: false,
    });

  it("removes the selected dataset when nothing else handled the key", () => {
    withDataset();
    renderHook(() => useGlobalShortcuts());
    fireEvent.keyDown(window, { key: "Delete" });
    expect(useApp.getState().datasets).toHaveLength(0);
  });

  /** Dispatch Delete from an element whose own handler consumes it — the real
   *  shape of the bug: the keystroke arrives at this window listener already
   *  `defaultPrevented`, because `preventDefault()` never stops propagation.
   *  (`defaultPrevented` is read-only, so it cannot be faked via event init.) */
  const consumedKeyDown = (key: string) => {
    const inner = document.createElement("div");
    document.body.appendChild(inner);
    const consume = (e: KeyboardEvent) => {
      if (e.key === key) e.preventDefault();
    };
    inner.addEventListener("keydown", consume);
    fireEvent.keyDown(inner, { key, bubbles: true, cancelable: true });
    inner.removeEventListener("keydown", consume);
    inner.remove();
  };

  it("leaves the dataset alone when a closer handler already preventDefaulted", () => {
    withDataset();
    renderHook(() => useGlobalShortcuts());
    consumedKeyDown("Delete");
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("applies to Backspace too — the key that also triggers browser Back", () => {
    withDataset();
    renderHook(() => useGlobalShortcuts());
    consumedKeyDown("Backspace");
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});
