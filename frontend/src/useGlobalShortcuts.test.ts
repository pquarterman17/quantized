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
