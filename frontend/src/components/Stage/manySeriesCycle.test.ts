// Plot audit round 2: past eight series the palette repeats (series 9 is
// series 1's colour), so the P3.3 dash/marker cycle engages on its own — on
// the canvas AND in the export of that canvas — without the preference. It
// still refuses every view the preference would refuse (grouped, faceted,
// stacked, polar, stat, a pinned document), since those exports cannot follow.

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { buildStageFigureSpec } from "../../lib/figureSpecStage";
import { defaultPlotView, type PlotView } from "../../lib/plotview";
import { installSeriesPalette } from "../../lib/regressionMatrix.testkit";
import { SERIES_VARS, windowCyclesSeriesStyles } from "../../lib/seriesStyleCycle";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import { selectSessionCyclesSeriesStyles } from "../workshops/figurebuilder/canonicalSession";
import { selectFocusedWindowCycles, useStageSeriesCycle, useWindowSeriesCycle } from "./useStageSeriesCycle";

const N = SERIES_VARS.length;
const plain: PlotView = defaultPlotView();
const n = N + 2;
const dataset: Dataset = {
  id: "ten",
  name: "ten.csv",
  data: {
    time: [0, 1, 2],
    values: [0, 1, 2].map((r) => Array.from({ length: n }, (_, c) => r + c)),
    labels: Array.from({ length: n }, (_, c) => `s${c}`),
    units: Array.from({ length: n }, () => ""),
    metadata: {},
  },
};

afterEach(() => useApp.setState({ autoSeriesStyles: false, groupKey: null, stackMode: false, plotWindows: [], focusedWindowId: null }));

describe("the cycle engages past the palette", () => {
  it("decides on the series count when the preference is off", () => {
    expect(windowCyclesSeriesStyles(false, plain, undefined, N)).toBe(false);
    expect(windowCyclesSeriesStyles(false, plain, undefined, N + 1)).toBe(true);
    // ...and refuses exactly what the preference refuses.
    expect(windowCyclesSeriesStyles(false, { ...plain, groupKey: 0 }, undefined, N + 1)).toBe(false);
    expect(windowCyclesSeriesStyles(false, { ...plain, stackMode: true }, undefined, N + 1)).toBe(false);
  });

  it("cycles the focused Stage and a background window by their own series counts", () => {
    useApp.setState({ autoSeriesStyles: false, groupKey: null, stackMode: false });
    expect(renderHook(() => useStageSeriesCycle(N)).result.current).toBeNull();
    expect(renderHook(() => useStageSeriesCycle(N + 1)).result.current).toHaveLength(N + 1);
    expect(selectFocusedWindowCycles(useApp.getState(), N + 1)).toBe(true);
    expect(renderHook(() => useWindowSeriesCycle(plain, undefined, N + 1)).result.current).toHaveLength(N + 1);
  });

  it("cycles the Publication Preview of a window that draws ten series", () => {
    const win = { id: "w1", kind: "plot", datasetId: "ten", view: plain, document: undefined };
    const state = {
      ...useApp.getState(),
      ...plain,
      datasets: [dataset],
      activeId: "ten",
      plotWindows: [win],
      focusedWindowId: "w1",
      figurePublicationSession: { target: "window", windowId: "w1" },
    } as never;
    expect(selectSessionCyclesSeriesStyles(state)).toBe(true);
  });

  it("exports the same dashes the canvas draws for ten series", () => {
    const restore = installSeriesPalette();
    const state = { ...defaultPlotView(), autoSeriesStyles: false, focusedWindowId: null, windowsForSave: () => [] };
    const spec = buildStageFigureSpec((() => state) as never, dataset, "ten", {
      fmt: "pdf", style: "default", dpi: 300, title: "", xLabel: "", yLabel: "",
    });
    const lines = (spec.series_styles ?? []).map((s) => s?.line ?? null);
    // Display position i takes AUTO_DASH_CYCLE[i % 3]: solid, dashed, dotted, ...
    expect(lines.slice(0, 4)).toEqual(["solid", "dashed", "dotted", "solid"]);
    // Series 9 shares series 1's colour, and no longer its line.
    expect(spec.series_styles?.[N]?.color).toBe(spec.series_styles?.[0]?.color);
    expect(lines[N]).not.toBe(lines[0]);
    restore();
  });
});
