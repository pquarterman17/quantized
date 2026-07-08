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
    macroRecording: false,
    stackMode: false,
    spatialPanels: null,
    facetPanels: null,
    breakPanels: null,
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
