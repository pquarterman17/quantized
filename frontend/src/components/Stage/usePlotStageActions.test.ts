// usePlotStageActions's onRegionSelect: the baseline workshop's rubber-band
// gesture handler. Covers the optional 2-D y-box addition (MATLAB
// `onBGMouseUp` parity, GAP #96/#20) — the x-only path (y0/y1 undefined) is
// the pre-existing behavior and must stay byte-identical.

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { PlotPayload } from "../../lib/plotdata";
import { useApp } from "../../store/useApp";
import { usePlotStageActions } from "./usePlotStageActions";

const payload: PlotPayload = {
  data: [
    [0, 1, 2, 3, 4],
    [10, 20, 30, 40, 50],
  ],
  series: [{ label: "M", unit: "emu" }],
  xLabel: "Field",
  xUnit: "Oe",
};

beforeEach(() => {
  useApp.setState({ plotTool: "region", regionPicked: null });
});

function pickWithHook(payload: PlotPayload | null) {
  return renderHook(() => usePlotStageActions({ current: null }, payload, null));
}

describe("usePlotStageActions onRegionSelect", () => {
  it("picks an x-only region when no y is given (unchanged behavior)", () => {
    const { result } = pickWithHook(payload);
    result.current.onRegionSelect(1, 3);
    expect(useApp.getState().regionPicked).toEqual({ x: [1, 3] });
    expect(useApp.getState().plotTool).toBe("zoom"); // exits to zoom, as before
  });

  it("clamps the x window to the plotted x-extent, as before", () => {
    const { result } = pickWithHook(payload);
    result.current.onRegionSelect(-5, 99);
    expect(useApp.getState().regionPicked).toEqual({ x: [0, 4] });
  });

  it("ignores a degenerate (zero-width) x drag, even with y given", () => {
    const { result } = pickWithHook(payload);
    result.current.onRegionSelect(2, 2, 15, 35);
    expect(useApp.getState().regionPicked).toBeNull();
  });

  it("carries a y-range when a genuine 2-D box is dragged", () => {
    const { result } = pickWithHook(payload);
    result.current.onRegionSelect(1, 3, 35, 15); // inverted y drag too
    expect(useApp.getState().regionPicked).toEqual({ x: [1, 3], yRange: [15, 35] });
  });

  it("clamps the y-range to the plotted y-extent across all series", () => {
    const { result } = pickWithHook(payload);
    result.current.onRegionSelect(1, 3, -100, 25);
    expect(useApp.getState().regionPicked).toEqual({ x: [1, 3], yRange: [10, 25] });
  });

  it("drops yRange for a degenerate y span, keeping the x pick", () => {
    const { result } = pickWithHook(payload);
    result.current.onRegionSelect(1, 3, 20, 20);
    expect(useApp.getState().regionPicked).toEqual({ x: [1, 3] });
  });

  it("does nothing without a display payload", () => {
    const { result } = pickWithHook(null);
    result.current.onRegionSelect(1, 3, 15, 35);
    expect(useApp.getState().regionPicked).toBeNull();
    expect(useApp.getState().plotTool).toBe("region"); // never exited
  });
});
