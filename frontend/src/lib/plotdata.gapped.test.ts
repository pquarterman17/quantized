// A wide server-decimated payload carries per-series `kept` row positions.
// Filler (a row the series did not pick) must reach uPlot as `undefined`, which
// uPlot's path builder skips and draws across, while a REAL missing value stays
// `null`, which uPlot breaks the line at (uPlot 1.6.32: findGaps tests
// `yVal === null`; the line builder only skips `undefined`). A blanket
// `spanGaps` would connect a genuine NaN run, so the series must keep
// `spanGaps: false`.
import { describe, expect, it, vi } from "vitest";

import { fetchPlot } from "./plotdata";
import type { DataStruct } from "./types";
import { readoutPlugin } from "./uplotPointerTools";

const plotSeriesMock = vi.fn();
vi.mock("./api", () => ({
  plotSeries: (req: unknown, signal?: AbortSignal) => plotSeriesMock(req, signal),
}));

const ds: DataStruct = { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["A"], units: [""], metadata: {} };

// 8 union rows. Series A picked rows 0, 3, 7 and has a genuine NaN run on rows
// 4-5 (its `kept` includes them, as nulls); rows 1, 2 and 6 are filler.
const RESPONSE = {
  data: [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [5, null, null, 9, null, null, null, 4],
  ],
  series: [{ label: "A", unit: "", axis: 0 }],
  x: { label: "x", unit: "", log: false },
  y: { log: false },
  decimated: true,
  kept: [[0, 3, 4, 5, 7]],
};

describe("a gapped payload keeps filler and real gaps apart", () => {
  it("hands uPlot undefined for filler and null for a genuine NaN run", async () => {
    plotSeriesMock.mockResolvedValueOnce(RESPONSE);
    const p = await fetchPlot(ds, false, false, null, null, null, 800);
    const col = p.data[1] as (number | null | undefined)[];
    expect(col).toEqual([5, undefined, undefined, 9, null, null, undefined, 4]);
    expect(col[4]).toBeNull();
    expect(col[1]).toBeUndefined();
    expect(p.data[0]).toEqual(RESPONSE.data[0]);
  });

  it("a payload without `kept` is passed through untouched", async () => {
    plotSeriesMock.mockResolvedValueOnce({ ...RESPONSE, kept: null });
    const p = await fetchPlot(ds, false, false, null, null, null, 800);
    expect(p.data[1]).toEqual(RESPONSE.data[1]);
  });
});

describe("readout on a gapped plot", () => {
  const data = [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [5, undefined, undefined, 9, null, null, undefined, 4],
  ];
  function readAt(idx: number, spanGaps = false) {
    let got: unknown = null;
    const plugin = readoutPlugin((r) => {
      got = r;
    });
    // @ts-expect-error minimal uPlot stand-in
    plugin.hooks.setCursor?.({ cursor: { idx }, data, series: [{}, { label: "A", spanGaps }] });
    return got;
  }

  it("fills filler with the nearest real value", () => {
    expect(readAt(1)).toEqual({ x: 1, rows: [{ label: "A", y: 5 }] });
    expect(readAt(2)).toEqual({ x: 2, rows: [{ label: "A", y: 9 }] });
  });

  it("shows nothing inside a genuine NaN run, and never reaches across it", () => {
    expect(readAt(4)).toBeNull();
    expect(readAt(5)).toBeNull();
    expect(readAt(6)).toBeNull(); // filler whose nearest entry (ties go left) is the real gap
  });

  it("does not depend on spanGaps: a genuine NaN run is never filled", () => {
    expect(readAt(4, true)).toBeNull();
    expect(readAt(5, true)).toBeNull();
  });
});
