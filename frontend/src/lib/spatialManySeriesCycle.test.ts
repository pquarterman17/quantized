// Plot audit round 3 (round-2 deferral): past eight series the palette repeats,
// so a flat plot engages the P3.3 dash/marker cycle without the preference
// (`Stage/manySeriesCycle.test.ts`). A SPATIAL multi-panel cell did not — its
// ninth curve was its first again — and the cell canvas, its legend and the
// page export must all engage together, per panel, by that panel's own count.

import { describe, expect, it } from "vitest";

import { spatialCellStyling, type SpatialPanel } from "./multipanel";
import { defaultPageSetup } from "./pageGeometry";
import { SERIES_VARS } from "./seriesStyleCycle";
import { buildSpatialPageRequest } from "./spatialPageExport";
import type { DataStruct } from "./types";

const N = SERIES_VARS.length;
const cols = N + 2;
const data: DataStruct = {
  time: [0, 1, 2],
  values: [0, 1, 2].map((r) => Array.from({ length: cols + 1 }, (_, c) => r + c)),
  labels: Array.from({ length: cols + 1 }, (_, c) => `s${c}`),
  units: Array.from({ length: cols + 1 }, () => ""),
  metadata: {},
};
const keys = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const panel = (yKeys: number[]): SpatialPanel => ({
  datasetId: "ds1", xKey: 0, yKeys, xLim: [0, 1], yLim: [0, 1], xLog: false, yLog: false, row: 0, col: 0,
  pageRect: { left: 0.1, top: 0.1, width: 0.4, height: 0.4 },
  seriesLabels: Object.fromEntries(yKeys.map((k) => [k, `s${k}`])),
});
const appearance = {
  xFmt: { mode: "auto" as const, digits: 2 }, yFmt: { mode: "auto" as const, digits: 2 },
  showGrid: true, showAxisBox: false, autoSeriesStyles: false,
};
const exported = (p: SpatialPanel) =>
  (buildSpatialPageRequest([p], new Map([["ds1", data]]), defaultPageSetup(), appearance)!.panels[0].figure.series_styles ?? [])
    .map((s) => s?.line);

describe("a spatial cell past the palette", () => {
  it("cycles its canvas, its legend and its export alike without the preference", () => {
    const p = panel(keys(cols));
    const cell = spatialCellStyling(p, false);
    expect(cell.cellCycle).toHaveLength(cols);
    const legend = cell.legendEntries.map((e) => e.style?.line);
    expect(legend.slice(0, 4)).toEqual(["solid", "dashed", "dotted", "solid"]);
    // Series 9 shares series 1's colour, and no longer its line.
    expect(legend[N]).not.toBe(legend[0]);
    expect(exported(p)).toEqual(legend);
  });

  it("stays uncycled at eight series, on both sides", () => {
    const p = panel(keys(N));
    expect(spatialCellStyling(p, false).cellCycle).toBeNull();
    expect(exported(p).every((l) => l === undefined)).toBe(true);
  });

  it("counts the series the cell draws: hidden ones do not engage it", () => {
    const p = { ...panel(keys(cols)), hiddenChannels: [1, 2] };
    expect(spatialCellStyling(p, false).cellCycle).toBeNull();
    expect(exported(p).every((l) => l === undefined)).toBe(true);
  });
});
