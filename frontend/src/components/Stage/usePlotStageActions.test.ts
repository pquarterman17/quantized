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

// Finding 2 (Group AB adversarial review, round 2): plottedYExtent must skip
// a secondary-axis (axis:1) series — e.g. a dy/dx differentiate overlay —
// when clamping the y-box, since that series' range is on a totally
// different calibration than the primary-axis data the baseline fit reads.
describe("usePlotStageActions onRegionSelect y-extent skips secondary-axis series", () => {
  const withY2Overlay: PlotPayload = {
    data: [
      [0, 1, 2, 3, 4],
      [10, 20, 30, 40, 50], // primary (fit data)
      [-500, 900, -700, 800, -600], // axis:1 overlay — wildly different range
    ],
    series: [{ label: "M", unit: "emu" }, { label: "dy/dx", unit: "", axis: 1 }],
    xLabel: "Field",
    xUnit: "Oe",
  };

  it("clamps to the primary series' own extent, ignoring the y2 overlay's range", () => {
    const { result } = pickWithHook(withY2Overlay);
    // A drag past both extremes: the primary data only reaches [10,50]; if
    // the y2 overlay's [-700,900] leaked in, this would clamp to that instead.
    result.current.onRegionSelect(1, 3, -1000, 1000);
    expect(useApp.getState().regionPicked).toEqual({ x: [1, 3], yRange: [10, 50] });
  });

  // Round-2 finding 1: when EVERY plotted series sits on the secondary axis
  // (the dual-Y toggle applied to the plot's only channel), the clamp must
  // fall back to THAT series' own extent — mirroring uplotOpts's
  // `regionYScale`'s "y2 only when nothing is primary" rule — rather than
  // skipping the clamp altogether, which would leave an unbounded y-range on
  // a plot that plainly has real, finite data.
  it("clamps to the y2 extent when every plotted series is on the secondary axis", () => {
    const allY2: PlotPayload = {
      data: [
        [0, 1, 2, 3, 4],
        [10, 20, 30, 40, 50],
      ],
      series: [{ label: "M", unit: "emu", axis: 1 }],
      xLabel: "Field",
      xUnit: "Oe",
    };
    const { result } = pickWithHook(allY2);
    result.current.onRegionSelect(1, 3, -1000, 1000);
    expect(useApp.getState().regionPicked).toEqual({ x: [1, 3], yRange: [10, 50] });
  });
});
