// The toolbar's Reset view, then Back (Alt+Left): Back restores the view the
// reset left. With a HALF-OPEN limit (a side on auto, P2.8 residual (b)) that
// is the committed pair, not the live scale's concrete numbers — otherwise
// Back freezes the auto side at whatever the data extent happened to be, and
// the axis stops following the data. The `A` shortcut and the palette's
// Autoscale command already record the committed pair.

import type uPlot from "uplot";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PlotPayload } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";
import { usePlotStageActions } from "./usePlotStageActions";

const payload = {
  data: [
    [0, 1, 2],
    [10, 20, 30],
  ],
  series: [{ label: "M", unit: "" }],
  xLabel: "x",
  xUnit: "",
} as unknown as PlotPayload;

/** The live instance: a half-open x [1, auto] resolved to [1, 2.04]. */
const plot = {
  scales: { x: { min: 1, max: 2.04 }, y: { min: 8, max: 32 } },
  setData: () => {},
} as unknown as uPlot;

afterEach(() => {
  useApp.setState({ xLim: null, yLim: null, viewHistory: [], viewFuture: [] });
});

describe("usePlotStageActions resetView with a half-open limit", () => {
  it("Back after Reset view restores the half-open pair, not the live numbers", () => {
    useApp.setState({ xLim: [1, null], yLim: null, viewHistory: [], viewFuture: [] });
    const { result } = renderHook(() => usePlotStageActions({ current: plot }, payload, null));
    result.current.resetView();
    expect(useApp.getState().xLim).toBeNull();
    useApp.getState().backView();
    expect(useApp.getState().xLim).toEqual([1, null]);
  });

  it("Back after a canvas zoom (recorded with live numbers) restores the half-open pair too", () => {
    useApp.setState({ xLim: [1, null], yLim: [null, 25], viewHistory: [], viewFuture: [] });
    // viewHistoryPlugin's commit: the live bounds before and after the gesture.
    useApp.getState().recordView({ xLim: [1, 2.04], yLim: [8, 25] }, { xLim: [1.2, 1.8], yLim: [12, 20] });
    expect(useApp.getState().xLim).toEqual([1.2, 1.8]);
    useApp.getState().backView();
    expect(useApp.getState().xLim).toEqual([1, null]);
    expect(useApp.getState().yLim).toEqual([null, 25]);
  });

  it("a plain click (live bounds unchanged) still records nothing", () => {
    useApp.setState({ xLim: [1, null], yLim: null, viewHistory: [], viewFuture: [] });
    useApp.getState().recordView({ xLim: [1, 2.04], yLim: [8, 32] }, { xLim: [1, 2.04], yLim: [8, 32] });
    expect(useApp.getState().xLim).toEqual([1, null]);
    expect(useApp.getState().viewHistory).toHaveLength(0);
  });

  it("a fully fixed or auto axis still records the live view (unchanged)", () => {
    useApp.setState({ xLim: [1, 2.04], yLim: null, viewHistory: [], viewFuture: [] });
    const { result } = renderHook(() => usePlotStageActions({ current: plot }, payload, null));
    result.current.resetView();
    useApp.getState().backView();
    expect(useApp.getState().xLim).toEqual([1, 2.04]);
    expect(useApp.getState().yLim).toEqual([8, 32]);
  });
});
