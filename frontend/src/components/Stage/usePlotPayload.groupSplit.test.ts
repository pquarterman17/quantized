// P1.5 (PRIMARY_SOFTWARE_AUDIT_PLAN): the live Stage's own group-split
// wiring, end to end through the REAL usePlotPayload pipeline (no
// lib/plotdata mock -- fetchPlot's offline fallback, buildColumns, runs
// synchronously against a jsdom environment with no backend, same pattern
// usePlotPayload.quickFigureParity.test.ts already relies on).

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { DataStruct, Dataset } from "../../lib/types";
import { usePlotPayload, type PlotPayloadParams } from "./usePlotPayload";

const raw: DataStruct = {
  time: [1, 2, 3, 4],
  values: [
    [10, 0],
    [20, 1],
    [30, 0],
    [40, 1],
  ],
  labels: ["Moment", "Sample"],
  units: ["emu", ""],
  metadata: {},
  // P1.5 item 3: level-aware labels resolve through cat_levels, never a raw
  // code -- so the split series must say "Alpha"/"Beta", not "0"/"1".
  cat_levels: { 1: ["Alpha", "Beta"] },
};

const dataset: Dataset = { id: "d1", name: "x", data: raw };

function baseParams(overrides: Partial<PlotPayloadParams> = {}): PlotPayloadParams {
  return {
    active: dataset,
    yScale: "linear",
    xScale: "linear",
    xKey: null,
    yKeys: [0],
    groupKey: null,
    y2Keys: null,
    seriesOrder: null,
    seriesStyles: {},
    seriesLabels: {},
    errKeys: {},
    hiddenChannels: [],
    waterfall: 0,
    excludedDisplay: "hide",
    fitOverlay: null,
    baselineOverlay: null,
    peakOverlay: null,
    derivOverlay: null,
    selection: null,
    xLim: null,
    ...overrides,
  };
}

describe("usePlotPayload — P1.5 live group split", () => {
  it("splits the plotted Y channel into one series per level, labeled through cat_levels", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams({ groupKey: 1 }),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    const series = result.current.displayPayload!.series;
    expect(series.map((s) => s.label)).toEqual(["Moment (Sample=Alpha)", "Moment (Sample=Beta)"]);
    // rows 0,2 are level 0 (Alpha); rows 1,3 are level 1 (Beta).
    expect(result.current.displayPayload!.data).toEqual([
      [1, 2, 3, 4],
      [10, null, 30, null],
      [null, 20, null, 40],
    ]);
  });

  it("plotted repeats the base channel once per level (edit-all identity)", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams({ groupKey: 1 }),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    expect(result.current.plotted).toEqual([0, 0]);
  });

  it("restyle/hide on the base channel affects every expanded level (edit-all ruling)", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams({
        groupKey: 1,
        seriesStyles: { 0: { color: "#f00" } },
        hiddenChannels: [0],
      }),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    expect(result.current.styleList).toEqual([{ color: "#f00" }, { color: "#f00" }]);
    expect(result.current.hidden).toEqual([true, true]);
  });

  it("suppresses error bars/spans/color-by when grouped (no sound per-level mapping)", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams({ groupKey: 1, errKeys: { 0: 0 } }),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    expect(result.current.errorBars.size).toBe(0);
    expect(result.current.errorSpans.size).toBe(0);
    expect(result.current.colorByColumns.size).toBe(0);
  });

  it("degrades to ungrouped when a secondary Y axis is active", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams({ groupKey: 1, y2Keys: [0] }),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    expect(result.current.displayPayload!.series.map((s) => s.label)).toEqual(["Moment"]);
    expect(result.current.plotted).toEqual([0]);
  });

  it("is a no-op (ordinary ungrouped render) when groupKey is null", async () => {
    const { result } = renderHook((p: PlotPayloadParams) => usePlotPayload(p), {
      initialProps: baseParams(),
    });
    await waitFor(() => expect(result.current.displayPayload).not.toBeNull());
    expect(result.current.displayPayload!.series.map((s) => s.label)).toEqual(["Moment"]);
    expect(result.current.plotted).toEqual([0]);
  });
});
