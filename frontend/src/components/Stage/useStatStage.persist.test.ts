// The Stat Stage picks persist per window (`PlotView.statPicks`): plot type,
// group / nested group / value / facet / colour-by columns, and the Q-Q,
// histogram and bar options. They were React state, so File ▸ Save workspace
// + reopen came back in box mode with default columns. These tests drive the
// hook wired to the store exactly as `StatStage` wires it, through the real
// save path (windowsForSave -> serializeWorkspace -> parseWorkspace ->
// loadWorkspace).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsBox } from "../../lib/api";
import { defaultPlotView } from "../../lib/plotview";
import type { StatPicks } from "../../lib/plotviewSanitize";
import type { DataStruct, Dataset } from "../../lib/types";
import { parseWorkspace } from "../../lib/workspace";
import { serializeWorkspace } from "../../lib/workspaceSerialize";
import { setStatPicks } from "../../store/statLevelOptions";
import { useActiveDataset, useApp } from "../../store/useApp";
import { useStatStage, type UseStatStageParams } from "./useStatStage";

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  statsBox: vi.fn(),
  statsViolin: vi.fn(),
}));

// grp (0) and fac (2) read as categorical (2 levels, 12 finite samples each);
// y (1) is the continuous value column.
const DATA: DataStruct = {
  time: Array.from({ length: 12 }, (_, i) => i),
  values: Array.from({ length: 12 }, (_, i) => [i % 2, 10 + i, Math.floor(i / 6)]),
  labels: ["grp", "y", "fac"],
  units: ["", "", ""],
  metadata: {},
};
const DS: Dataset = { id: "d1", name: "run.dat", data: DATA };

const noop = () => {};

/** The hook as the focused `StatStage` wires it: the live store fields. */
function useWiredStage() {
  return useStatStage({
    active: useActiveDataset(),
    yKeys: null,
    xKey: null,
    seriesOrder: null,
    seed: null,
    onSeedConsumed: noop,
    picks: useApp((s) => s.statPicks),
    onPicksChange: setStatPicks,
  });
}

const save = () => {
  const s = useApp.getState();
  return serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });
};

function pickEverything(st: ReturnType<typeof useWiredStage>) {
  act(() => st.setMode("violin"));
  act(() => st.setGroupCol(2));
  act(() => st.setGroup2Col(0));
  act(() => st.setValueCol(1));
  act(() => st.setFacetCol(0));
  act(() => st.setColorCol(2));
  act(() => st.setDist("laplace"));
  act(() => st.setBins("scott"));
  act(() => st.setFit("norm"));
  act(() => st.setBarStack(true));
}

const PICKED = {
  mode: "violin", groupCol: 2, group2Col: 0, valueCol: 1, facetCol: 0,
  dist: "laplace", bins: "scott", fit: "norm", barStack: true,
} as const;

const shown = (st: ReturnType<typeof useWiredStage>) => ({
  mode: st.mode, groupCol: st.groupCol, group2Col: st.group2Col, valueCol: st.valueCol, facetCol: st.facetCol,
  dist: st.dist, bins: st.bins, fit: st.fit, barStack: st.barStack,
});

beforeEach(() => {
  vi.mocked(statsBox).mockImplementation(() => new Promise(() => {}));
  const init = useApp.getInitialState(); // the startup main window, so the save carries a view
  useApp.setState({
    datasets: [{ ...DS }],
    activeId: "d1",
    statMode: true,
    statPicks: {},
    plotWindows: init.plotWindows,
    focusedWindowId: init.focusedWindowId,
    history: [],
    future: [],
  });
});

describe("Stat Stage picks: File ▸ Save workspace + reopen", () => {
  it("every pick comes back after a real save and reopen", () => {
    const first = renderHook(() => useWiredStage());
    expect(first.result.current.mode).toBe("box"); // the defaults, before any pick
    pickEverything(first.result.current);
    expect(shown(first.result.current)).toEqual(PICKED);
    const text = save();
    first.unmount();

    useApp.setState({ statPicks: {}, datasets: [] });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    const reopened = renderHook(() => useWiredStage());
    expect(shown(reopened.result.current)).toEqual(PICKED);
    expect(reopened.result.current.colorCol).toBe(2);
  });

  it("a reopen into an ALREADY-MOUNTED stage replaces its picks with the file's", () => {
    const { result } = renderHook(() => useWiredStage());
    pickEverything(result.current);
    const text = save();
    act(() => result.current.setMode("histogram"));
    act(() => result.current.setGroupCol(0));
    act(() => result.current.setBins("fd"));

    act(() => useApp.getState().loadWorkspace(parseWorkspace(text)));
    expect(shown(result.current)).toEqual(PICKED);
  });

  it("each pick is one undo entry", () => {
    const { result } = renderHook(() => useWiredStage());
    act(() => result.current.setMode("strip"));
    act(() => result.current.setGroupCol(2));
    expect(useApp.getState().history).toHaveLength(2);
    act(() => useApp.getState().undo());
    expect(result.current.groupCol).toBe(0);
    expect(result.current.mode).toBe("strip");
  });
});

describe("Stat Stage picks: restored picks vs the per-dataset defaults", () => {
  const saved: StatPicks = {
    mode: "strip",
    cols: { group: [2, "fac"], group2: [0, "grp"], value: [1, "y"], facet: null, color: [0, "grp"] },
  };
  const params = (over: Partial<UseStatStageParams>): UseStatStageParams => ({
    active: DS, yKeys: null, xKey: null, seriesOrder: null, seed: null, onSeedConsumed: noop,
    picks: saved, onPicksChange: noop, ...over,
  });

  it("picks restored before the dataset is there survive its arrival (no reset wipes them)", () => {
    useApp.setState({ statPicks: saved, datasets: [], activeId: null });
    const { result } = renderHook(() => useWiredStage());
    act(() => useApp.setState({ datasets: [DS], activeId: "d1" }));
    expect(useApp.getState().statPicks).toBe(saved);
    expect(result.current.mode).toBe("strip");
    expect([result.current.groupCol, result.current.group2Col, result.current.valueCol]).toEqual([2, 0, 1]);
    expect(result.current.colorCol).toBe(0);
  });

  it("a column found under its label at another index is followed there", () => {
    const moved: Dataset = {
      id: "d2", name: "moved", data: { ...DATA, labels: ["fac", "y", "grp"], values: DATA.values.map(([a, b, c]) => [c, b, a]) },
    };
    const { result } = renderHook(() => useStatStage(params({ active: moved })));
    expect([result.current.groupCol, result.current.group2Col, result.current.valueCol]).toEqual([0, 2, 1]);
  });

  it("a saved column that no longer exists falls back to the dataset's default columns", () => {
    const renamed: Dataset = { id: "d3", name: "renamed", data: { ...DATA, labels: ["grp", "y", "site"] } };
    const { result } = renderHook(() => useStatStage(params({ active: renamed })));
    expect(result.current.mode).toBe("strip"); // non-column picks are kept
    expect([result.current.groupCol, result.current.group2Col, result.current.valueCol]).toEqual([0, null, 1]);
    expect([result.current.facetCol, result.current.colorCol]).toEqual([null, null]);
  });

  it("no saved picks (an older file) reads as today's defaults", () => {
    const { result } = renderHook(() => useStatStage(params({ picks: defaultPlotView().statPicks })));
    expect(shown(result.current as ReturnType<typeof useWiredStage>)).toEqual({
      mode: "box", groupCol: 0, group2Col: null, valueCol: 1, facetCol: null,
      dist: "norm", bins: "fd", fit: null, barStack: false,
    });
  });
});
