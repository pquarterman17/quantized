// Undo-coverage audit (2026-10-01): committing a Graph Builder graph is ONE
// gesture, so it must be ONE undo step. It drives a run of store actions
// (setXKey, setYKeys, setStatMode, a style per Y channel, ...), each of which
// records its own entry; without folding, Ctrl+Z walked back through
// half-applied plots one setting at a time.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useGraphBuilder } from "./useGraphBuilder";

vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[1, 10, 5], [2, 12, 6], [3, 14, 7], [4, 16, 8]],
  labels: ["x", "y", "z"],
  units: ["s", "emu", "emu"],
  metadata: {},
};

const INITIAL_WINDOWS = useApp.getState().plotWindows;
const INITIAL_FOCUSED = useApp.getState().focusedWindowId;

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    statMode: true,
    seriesStyles: {},
    history: [],
    future: [],
    plotWindows: INITIAL_WINDOWS,
    focusedWindowId: INITIAL_FOCUSED,
  });
});

function built() {
  const hook = renderHook(() => useGraphBuilder());
  act(() => hook.result.current.assign("x", 0));
  act(() => hook.result.current.assign("y", 1));
  act(() => hook.result.current.assign("y", 2));
  return hook.result;
}

describe("Graph Builder commit is one undo step", () => {
  it("Apply to Current Plot: one entry, and one undo restores the plot", () => {
    const result = built();
    const before = useApp.getState();
    act(() => result.current.applyToCurrent());
    expect(useApp.getState().yKeys).toEqual([1, 2]);
    expect(useApp.getState().history).toHaveLength(1);
    act(() => useApp.getState().undo());
    const s = useApp.getState();
    expect([s.xKey, s.yKeys, s.statMode, s.seriesStyles]).toEqual([before.xKey, before.yKeys, before.statMode, before.seriesStyles]);
  });

  it("Create New Plot: one entry, and one undo removes the window", () => {
    const result = built();
    const before = useApp.getState();
    act(() => result.current.createNewPlot());
    expect(useApp.getState().plotWindows).toHaveLength(before.plotWindows.length + 1);
    expect(useApp.getState().history).toHaveLength(1);
    act(() => useApp.getState().undo());
    expect(useApp.getState().plotWindows.map((w) => w.id)).toEqual(before.plotWindows.map((w) => w.id));
  });
});
