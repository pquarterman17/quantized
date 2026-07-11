import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useGraphBuilder } from "./useGraphBuilder";

// channel 0 monotonic continuous x, channel 1 continuous y, channel 2 a 2-level
// nominal grouping column (needs ≥12 rows for nominal inference), channel 3 a
// 2-level nominal FACET column (gap #21 residual — same 6/6 split as channel 2
// so a facet send has 2 finite levels to build panels from).
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [1, 10, 0, 0],
    [2, 12, 0, 0],
    [3, 14, 0, 0],
    [4, 16, 0, 0],
    [5, 18, 0, 0],
    [6, 20, 0, 0],
    [7, 30, 1, 1],
    [8, 32, 1, 1],
    [9, 34, 1, 1],
    [10, 36, 1, 1],
    [11, 38, 1, 1],
    [12, 40, 1, 1],
  ],
  labels: ["x", "y", "grp", "fct"],
  units: ["s", "emu", "", ""],
  metadata: { x_column_name: "T" },
};

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    status: "",
    xKey: null,
    yKeys: null,
    y2Keys: null,
    statMode: false,
    statStageSeed: null,
    graphBuilderSeed: null,
    macroRecording: false,
    stackMode: false,
    spatialPanels: null,
    facetPanels: null,
    breakPanels: null,
    // Owner-routing item 1: starts parked on Worksheet so "sendToStage
    // surfaces the Plot tab" assertions below don't need a separate fixture.
    stageTab: "worksheet",
  });
});

describe("useGraphBuilder — morphing", () => {
  it("starts empty with an incomplete hint", () => {
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.render.kind).toBe("message");
    expect(result.current.canSend).toBe(false);
  });

  it("two continuous columns yield a scatter", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    expect(result.current.mark).toBe("scatter");
    expect(result.current.family).toBe("xy");
    expect(result.current.render.kind).toBe("xy");
    expect(result.current.chips("y")).toEqual([{ channel: 1, label: "y" }]);
  });

  it("swapping a nominal column onto X morphs to box and cycles box→violin→bar", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2)); // nominal
    expect(result.current.mark).toBe("box");
    expect(result.current.render.kind).toBe("box");
    act(() => result.current.cycle());
    expect(result.current.mark).toBe("violin");
    act(() => result.current.cycle());
    expect(result.current.mark).toBe("bar");
    act(() => result.current.cycle());
    expect(result.current.mark).toBe("box");
  });

  it("resets the spec when the active dataset changes", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    expect(result.current.chips("y")).toHaveLength(1);
    act(() => {
      useApp.setState({
        datasets: [
          { id: "d1", name: "run.dat", data: DATA },
          { id: "d2", name: "other.dat", data: DATA },
        ],
        activeId: "d2",
      });
    });
    expect(result.current.chips("y")).toHaveLength(0);
  });
});

describe("useGraphBuilder — worksheet seed (MAIN_PLAN #4)", () => {
  const seedFor = (datasetId: string) => ({
    version: 1 as const,
    zones: {
      x: { datasetId, channel: 0 },
      y: [{ datasetId, channel: 1 }],
      group: null,
      facet: null,
    },
    mark: "scatter" as const,
  });

  it("consumes a pending seed on mount: wells prefilled, mark re-inferred, seed cleared", () => {
    // The worksheet handoff sets the seed BEFORE the panel mounts.
    act(() => useApp.getState().openGraphBuilderSeeded(seedFor("d1")));
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.chips("x")).toEqual([{ channel: 0, label: "x" }]);
    expect(result.current.chips("y")).toEqual([{ channel: 1, label: "y" }]);
    // Channel 0 is sorted-monotonic → the inferred honest default is a line.
    expect(result.current.mark).toBe("line");
    expect(useApp.getState().graphBuilderSeed).toBeNull(); // one-shot
  });

  it("consumes a seed handed while the panel is already open (even across a rebind)", () => {
    useApp.setState({
      datasets: [
        { id: "d1", name: "run.dat", data: DATA },
        { id: "d2", name: "other.dat", data: DATA },
      ],
    });
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 2)); // some prior state to overwrite
    act(() => {
      // The worksheet handoff for a NON-active dataset rebinds first, then
      // seeds — the dataset-change wipe and the seed land in the same commit,
      // and the seed (declared after the wipe) must win.
      useApp.setState({ activeId: "d2" });
      useApp.getState().openGraphBuilderSeeded(seedFor("d2"));
    });
    expect(result.current.chips("y")).toEqual([{ channel: 1, label: "y" }]);
    expect(useApp.getState().graphBuilderSeed).toBeNull();
  });

  it("drops (and clears) a seed for a dataset that isn't active — wrong labels otherwise", () => {
    act(() => useApp.getState().openGraphBuilderSeeded(seedFor("not-active")));
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.chips("y")).toEqual([]);
    expect(useApp.getState().graphBuilderSeed).toBeNull();
  });
});

describe("useGraphBuilder — send to stage", () => {
  it("scatter/line applies X/Y through the axis store actions and leaves stat mode", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.sendToStage());
    expect(useApp.getState().xKey).toBe(0);
    expect(useApp.getState().yKeys).toEqual([1]);
    expect(useApp.getState().statMode).toBe(false);
  });

  it("box/violin seeds the stat stage pickers and switches stat mode on", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2)); // nominal → box
    act(() => result.current.sendToStage());
    expect(useApp.getState().statStageSeed).toEqual({ mode: "box", groupCol: 2, valueCol: 1 });
    expect(useApp.getState().statMode).toBe(true);
  });

  // Owner-routing item 1 ("have to remember to toggle up"): every branch of
  // sendToStage renders inside the Plot tab (scatter/line on the canvas,
  // box/violin/bar via StatStage), so it must surface that tab regardless of
  // where the user currently is.
  it("forces the Plot tab even when starting on Worksheet — scatter/line", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.sendToStage());
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("forces the Plot tab even when starting on Worksheet — box/violin", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("x", 2));
    act(() => result.current.sendToStage());
    expect(useApp.getState().stageTab).toBe("plot");
  });

  it("scatter/line WITH a facet zone enters the main Stage's facet grid (gap #21 residual)", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.assign("facet", 3)); // 2-level nominal facet column
    act(() => result.current.sendToStage());
    const s = useApp.getState();
    expect(s.stackMode).toBe(true);
    expect(s.facetPanels).toHaveLength(2);
    expect(s.spatialPanels).toBeNull();
    // facetByColumn's own setActive resets the LIVE xKey/yKeys to null (same
    // as the App.tsx "Facet by column…" command path), but it read the x/y
    // selection just assigned (channel 0/1, not the time axis / all-channels
    // default) BEFORE that reset, baking it into each panel's payload.
    expect(s.facetPanels?.[0].payload.xLabel).toBe("x");
    expect(s.facetPanels?.[0].payload.series.map((ser) => ser.label)).toEqual(["y"]);
  });

  it("scatter/line WITHOUT a facet zone does not touch facetPanels/stackMode", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", 0));
    act(() => result.current.assign("y", 1));
    act(() => result.current.sendToStage());
    const s = useApp.getState();
    expect(s.facetPanels).toBeNull();
    expect(s.stackMode).toBe(false);
  });
});
