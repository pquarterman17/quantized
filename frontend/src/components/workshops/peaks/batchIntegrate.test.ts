// Batch peak integration, pure half: windows from peaks, the per-dataset
// series on the plotted channels (matched by name), the request (shared x vs
// per-dataset xs), the dataset x window result rows, the CSV, and the trend
// dataset vs a metadata field with its provenance — including a workspace
// save + reopen.

import { describe, expect, it } from "vitest";

import type { IntegrateBatchResponse } from "../../../lib/api/peaks";
import type { Dataset } from "../../../lib/types";
import { parseWorkspace } from "../../../lib/workspace";
import { serializeWorkspace } from "../../../lib/workspaceSerialize";
import {
  batchBody,
  batchIntegrateCsv,
  batchIntegrateRows,
  sameGrid,
  seriesFor,
  trendStruct,
  windowsFromPeaks,
  windowsProblem,
  type SourceOutcome,
} from "./batchIntegrate";

function ds(id: string, name: string, meta: Record<string, unknown>, x: number[], cols: Record<string, number[]>): Dataset {
  const labels = Object.keys(cols);
  return {
    id, name,
    data: {
      time: x,
      values: x.map((_, i) => labels.map((l) => cols[l][i])),
      labels, units: labels.map(() => ""),
      metadata: meta,
    },
  };
}

describe("windows", () => {
  it("turns peaks into center ± FWHM windows, sorted, skipping unusable peaks", () => {
    expect(windowsFromPeaks([
      { center: 50, fwhm: 2 },
      { center: 20, fwhm: 1 },
      { center: 30, fwhm: Number.NaN },
      { center: 40, fwhm: 0 },
    ])).toEqual([{ lo: 19, hi: 21 }, { lo: 48, hi: 52 }]);
  });

  it("rounds away float noise so a typed-looking window shows (1 - 0.8 is 0.2, not 0.19999999999999996)", () => {
    expect(windowsFromPeaks([{ center: 1, fwhm: 0.8 }])).toEqual([{ lo: 0.2, hi: 1.8 }]);
  });

  it("names what is wrong with the window list", () => {
    expect(windowsProblem([])).toMatch(/at least one/);
    expect(windowsProblem([{ lo: 5, hi: 5 }])).toMatch(/window 1/);
    expect(windowsProblem([{ lo: 1, hi: 2 }, { lo: Number.NaN, hi: 3 }])).toMatch(/window 2/);
    expect(windowsProblem([{ lo: 1, hi: 2 }])).toBeNull();
  });
});

describe("seriesFor", () => {
  const ch = { xLabel: null, yLabel: "I", xIndex: null, yIndex: 1 };

  it("matches the Y column by name in every dataset and drops gap rows", () => {
    const d = ds("d1", "a", {}, [0, 1, 2, 3], { T: [1, 1, 1, 1], I: [5, Number.NaN, 7, 8] });
    // "I" is at index 1 here too, but a dataset with it elsewhere still matches.
    const moved = ds("d2", "b", {}, [0, 1], { I: [3, 4], T: [0, 0] });
    expect(seriesFor(d, ch)).toEqual({ x: [0, 2, 3], y: [5, 7, 8], gaps: 1 });
    expect(seriesFor(moved, ch)).toEqual({ x: [0, 1], y: [3, 4], gaps: 0 });
  });

  it("fails closed, naming the missing column", () => {
    const d = ds("d1", "a", {}, [0, 1], { T: [1, 1] });
    expect(() => seriesFor(d, ch)).toThrow('no column named "I"');
  });
});

describe("batchBody", () => {
  const s = (x: number[]) => ({ name: "n", x, y: x.map(() => 1) });

  it("sends one shared x when every grid is identical, so alignment is possible", () => {
    expect(sameGrid([[1, 2, 3], [1, 2, 3]])).toBe(true);
    const body = batchBody([s([1, 2, 3]), s([1, 2, 3])], [{ lo: 1, hi: 3 }], { baseline: "linear", align: true });
    expect(body.x).toEqual([1, 2, 3]);
    expect(body.xs).toBeUndefined();
    expect(body.align).toBe(true);
  });

  it("sends each dataset's own x when grids differ (never resampled)", () => {
    expect(sameGrid([[1, 2, 3], [1, 2]])).toBe(false);
    const body = batchBody([s([1, 2, 3]), s([1, 2])], [{ lo: 1, hi: 2 }], { baseline: "none", align: false });
    expect(body.x).toBeUndefined();
    expect(body.xs).toEqual([[1, 2, 3], [1, 2]]);
    expect(body.regions).toEqual([[1, 2]]);
    expect(body.labels).toEqual(["n", "n"]);
  });
});

const WINDOWS = [{ lo: 10, hi: 20 }, { lo: 30, hi: 40 }];
const OUTCOMES: SourceOutcome[] = [
  { datasetId: "d1", name: "300 K scan", ok: true },
  { datasetId: "d2", name: "broken", ok: false, error: 'no column named "I"' },
  { datasetId: "d3", name: "100 K scan", ok: true },
];
const peak = (area: number, centroid: number) => ({
  region: [0, 0] as [number, number], area, area_pct: 50, centroid, height: 1, position: centroid, fwhm: 2,
});
const RES: IntegrateBatchResponse = {
  regions: [[10, 20], [30, 40]], n_spectra: 2, n_regions: 2, aligned: false, reference: 0,
  baseline: "linear", n_failed: 1,
  results: [
    { index: 0, label: "300 K scan", ok: true, shift_samples: 0, shift_x: 0, total_area: 30, peaks: [peak(10, 15), peak(20, 35)] },
    { index: 1, label: "100 K scan", ok: false, error: "region 1 [30, 40] contains fewer than 3 points", shift_samples: 0, shift_x: 0, total_area: null },
  ],
};

describe("batchIntegrateRows + CSV", () => {
  const rows = batchIntegrateRows(OUTCOMES, RES, WINDOWS);

  it("one row per dataset x window; a failed dataset is one row per window carrying the reason", () => {
    expect(rows.map((r) => [r.dataset, r.window, r.status])).toEqual([
      ["300 K scan", 1, "ok"], ["300 K scan", 2, "ok"],
      ["broken", 1, "error"], ["broken", 2, "error"],
      ["100 K scan", 1, "error"], ["100 K scan", 2, "error"],
    ]);
    expect(rows[1]).toMatchObject({ lo: 30, hi: 40, area: 20, centroid: 35 });
    expect(rows[2].error).toBe('no column named "I"');
    expect(rows[4].error).toMatch(/fewer than 3 points/);
    expect(rows[4].area).toBeNull();
  });

  it("writes an RFC 4180 CSV, quoting where needed, missing numbers empty", () => {
    const csv = batchIntegrateCsv(rows).split("\n");
    expect(csv[0]).toBe("dataset,window,lo,hi,status,area,area_pct,centroid,fwhm,height,shift_x,error");
    expect(csv[1]).toBe("300 K scan,1,10,20,ok,10,50,15,2,1,0,");
    expect(csv[3]).toBe('broken,1,10,20,error,,,,,,,"no column named ""I"""');
    expect(csv).toHaveLength(7);
  });
});

describe("trendStruct", () => {
  const RES2: IntegrateBatchResponse = {
    ...RES, n_failed: 0,
    results: [
      RES.results[0],
      { index: 1, label: "100 K scan", ok: true, shift_samples: 0, shift_x: 0, total_area: 9, peaks: [peak(4, 14), peak(5, 34)] },
    ],
  };
  const OK: SourceOutcome[] = [OUTCOMES[0], OUTCOMES[2], { datasetId: "d4", name: "no temp", ok: true }];
  const RES3: IntegrateBatchResponse = {
    ...RES2, n_spectra: 3,
    results: [...RES2.results, { index: 2, label: "no temp", ok: true, shift_samples: 0, shift_x: 0, total_area: 1, peaks: [peak(1, 1), peak(1, 1)] }],
  };
  const metaOf = new Map<string, Record<string, unknown>>([
    ["d1", { temperature: "300 K" }], ["d3", { temperature: 100 }], ["d4", {}],
  ]);
  const prov = { baseline: "linear", aligned: false, channels: { x: null, y: "I" }, ranAt: "2026-09-29T00:00:00Z" };

  it("x is the chosen metadata field (units parsed), rows sorted by it; datasets without it are skipped by name", () => {
    const rows = batchIntegrateRows(OK, RES3, WINDOWS);
    const { data, skipped } = trendStruct(rows, WINDOWS, OK, metaOf, ["temperature"], prov);
    expect(data.time).toEqual([100, 300]);
    expect(data.labels).toEqual(["Area 10–20", "Centroid 10–20", "FWHM 10–20", "Area 30–40", "Centroid 30–40", "FWHM 30–40"]);
    expect(data.values[0]).toEqual([4, 14, 2, 5, 34, 2]);
    expect(data.metadata.x_column_name).toBe("temperature");
    expect(data.metadata.x_column_unit).toBe("K");
    expect(skipped).toEqual(["no temp: no numeric temperature"]);
    expect(data.metadata.text_columns).toEqual({ Dataset: ["100 K scan", "300 K scan"] });
  });

  it("without a field, x is the dataset order", () => {
    const rows = batchIntegrateRows(OK, RES3, WINDOWS);
    const { data, skipped } = trendStruct(rows, WINDOWS, OK, metaOf, null, prov);
    expect(data.time).toEqual([1, 2, 3]);
    expect(data.metadata.x_column_name).toBe("Dataset #");
    expect(skipped).toEqual([]);
  });

  it("records provenance — windows, settings, channels, every source — and it survives save + reopen", () => {
    const rows = batchIntegrateRows(OK, RES3, WINDOWS);
    const { data } = trendStruct(rows, WINDOWS, OK, metaOf, ["temperature"], prov);
    const p = data.metadata.peakIntegrateBatch as Record<string, unknown>;
    expect(p).toMatchObject({
      windows: [[10, 20], [30, 40]], baseline: "linear", aligned: false,
      channels: { x: null, y: "I" }, xField: ["temperature"],
      sources: [{ id: "d1", name: "300 K scan" }, { id: "d3", name: "100 K scan" }, { id: "d4", name: "no temp" }],
      skipped: ["no temp: no numeric temperature"],
    });
    expect(data.metadata.source).toBe("peak-batch-integrate");
    const reopened = parseWorkspace(serializeWorkspace({
      datasets: [{ id: "t1", name: "trend", data }], activeId: "t1",
    }));
    expect(reopened.datasets[0].data.metadata.peakIntegrateBatch).toEqual(p);
  });
});
