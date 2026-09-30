// The X well's "dataset's own X" option (the spec's reserved negative
// channel): offered by name and unit, rendered against the dataset's X, and
// committed / captured as the same null xKey an empty X well means.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { OWN_X_CHANNEL } from "../../../lib/plotspecGroupCol";
import type { PlotSpec } from "../../../lib/plotspec";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { captureLiveBlocks } from "./captureLiveBlocks";
import { useGraphBuilder } from "./useGraphBuilder";

const DATA: DataStruct = {
  time: [10, 20, 30, 40],
  values: [
    [1, 5],
    [2, 6],
    [3, 7],
    [4, 8],
  ],
  labels: ["m", "m2"],
  units: ["emu", "emu"],
  metadata: { x_column_name: "Field", x_column_unit: "Oe" },
};

beforeEach(() => {
  useApp.setState({
    datasets: [{ id: "d1", name: "loop.dat", data: DATA }],
    activeId: "d1",
    xKey: 0, // a prior plot against a value column: the commit must clear it
    yKeys: null,
    groupKey: null,
    seriesStyles: {},
    seriesOrder: null,
    hiddenChannels: [],
    y2Keys: null,
    savedPlotSpecs: [],
    activePlotSpecId: null,
    graphBuilderSeed: null,
  });
});

describe("useGraphBuilder — the X well's own-X option", () => {
  it("lists the dataset's X first, by name and unit, in the X well only", () => {
    const { result } = renderHook(() => useGraphBuilder());
    expect(result.current.xOptions[0]).toEqual({ index: OWN_X_CHANNEL, label: "Field (Oe)" });
    expect(result.current.xOptions.slice(1)).toEqual(result.current.options);
    expect(result.current.options.some((o) => o.index < 0)).toBe(false);
  });

  it("assigning it shows a named chip and previews against the dataset's X", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", OWN_X_CHANNEL));
    act(() => result.current.assign("y", 0));
    expect(result.current.chips("x")).toEqual([{ channel: OWN_X_CHANNEL, label: "Field (Oe)" }]);
    const render = result.current.render;
    expect(render.kind === "xy" && render.payload.data[0]).toEqual(DATA.time);
  });

  it("commits to the Stage as xKey null, not the reserved channel", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", OWN_X_CHANNEL));
    act(() => result.current.assign("y", 0));
    act(() => result.current.createNewPlot());
    expect(useApp.getState().xKey).toBeNull();
    expect(useApp.getState().yKeys).toEqual([0]);
  });

  it("a saved spec keeps the own-X pick and reopens to the same preview", () => {
    const { result } = renderHook(() => useGraphBuilder());
    act(() => result.current.assign("x", OWN_X_CHANNEL));
    act(() => result.current.assign("y", 0));
    act(() => result.current.saveAs("loop"));
    const saved = useApp.getState().savedPlotSpecs[0];
    expect(saved.spec.zones.x).toEqual({ datasetId: "d1", channel: OWN_X_CHANNEL });
    act(() => result.current.reset());
    act(() => result.current.openSpec(saved.id));
    const render = result.current.render;
    expect(render.kind === "xy" && render.payload.data[0]).toEqual(DATA.time);
  });
});

describe("captureLiveBlocks — own X is not a plotted series", () => {
  it("captures no series order from a Y-only order", () => {
    useApp.setState({ seriesOrder: [0, 1] });
    const base: PlotSpec = {
      version: 1,
      zones: {
        x: { datasetId: "d1", channel: OWN_X_CHANNEL },
        y: [{ datasetId: "d1", channel: 0 }, { datasetId: "d1", channel: 1 }],
        group: null,
        facet: null,
        yErr: [],
        xErr: null,
      },
      mark: "line",
    };
    const out = captureLiveBlocks(base, useApp.getState);
    expect(out.display).toBeUndefined();
    expect(out.version).toBe(1);
  });
});
