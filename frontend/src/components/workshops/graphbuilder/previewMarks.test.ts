// JMP_GAP J5 residual (closed 2026-09-29): the Graph Builder's box / violin /
// bar PREVIEW draws the window's categorical marks (`PlotView.statMarks`, the
// same per-mode options the Stat Stage it sends to reads) — raw points with
// ORIGINAL rows (so a point's jitter is the stage's and the export's),
// summary marker, error bars — flat and per facet panel. Without a spec it
// draws exactly what it did before (no marks).

import { describe, expect, it } from "vitest";

import { facetSlices, facetSliceRowIds } from "../../../lib/facet";
import type { PlotSpec } from "../../../lib/plotspec";
import { specToRender } from "../../../lib/plotspec";
import { analysisView } from "../../../lib/rowstate";
import type { Dataset } from "../../../lib/types";
import { previewStatDraws } from "./previewMarks";

// lot x wafer x y; row 2 EXCLUDED, so every later row shifts in the view.
const ROWS = [
  [0, 0, 1], [0, 1, 2], [0, 0, 99], [0, 1, 3], [0, 0, 2.5], [0, 1, 40],
  [1, 0, 10], [1, 1, 11], [1, 0, 12], [1, 1, 13], [1, 0, 12.5], [1, 1, 11.5],
];
const EXCLUDED = 2;
const DS: Dataset = {
  id: "gp",
  name: "gp.csv",
  excludedRows: [EXCLUDED],
  data: {
    time: ROWS.map((_, i) => i),
    values: ROWS,
    labels: ["lot", "wafer", "y"],
    units: ["", "", ""],
    metadata: {},
    cat_levels: { 0: ["L1", "L2"], 1: ["W1", "W2"] },
  },
};
const ref = (channel: number) => ({ datasetId: "gp", channel });
const spec = (mark: PlotSpec["mark"], facet: boolean): PlotSpec => ({
  version: 1,
  zones: { x: ref(0), y: [ref(2)], group: null, facet: facet ? ref(1) : null, yErr: [], xErr: null },
  mark,
});
const lotRows = (lot: number, wafer: number | null) =>
  ROWS.flatMap((r, i) => (r[0] === lot && (wafer === null || r[1] === wafer) && i !== EXCLUDED ? [i] : []));

function pointRows(d: unknown): number[][] {
  const draw = d as { mode: string; points?: { points: { rowIndex: number }[] }[] | null };
  return (draw.points ?? []).map((g) => g.points.map((p) => p.rowIndex));
}

describe("previewStatDraws — box / violin", () => {
  it("flat box: the window's box marks, points on ORIGINAL rows", () => {
    const s = spec("box", false);
    const out = previewStatDraws(specToRender(s, [DS]), s, [DS], { box: { points: "all", summary: "mean" } });
    expect(out.flat?.mode).toBe("box");
    expect(out.flat && "marks" in out.flat && out.flat.marks).toMatchObject({ points: "all", summary: "mean" });
    expect(pointRows(out.flat)).toEqual([lotRows(0, null), lotRows(1, null)]);
  });

  it("faceted box: every panel's points carry its own ORIGINAL rows (facetSliceRowIds), no connect line", () => {
    const s = spec("box", true);
    const out = previewStatDraws(specToRender(s, [DS]), s, [DS], { box: { points: "all", connectMeans: true } });
    expect(out.facets?.map((f) => f.label)).toHaveLength(2);
    out.facets!.forEach((f, w) => {
      expect(pointRows(f.draw)).toEqual([lotRows(0, w), lotRows(1, w)]);
      expect("marks" in f.draw && f.draw.marks).toMatchObject({ points: "all", connectMeans: false });
    });
    // The one recipe, not a re-derivation: the same rows facetSliceRowIds gives.
    const { data, rowIds } = analysisView(DS);
    const slice = facetSlices(data!, 1)[0];
    expect(pointRows(out.facets![0].draw).flat().sort((a, b) => a - b)).toEqual(facetSliceRowIds(slice, rowIds));
  });

  it("violin previews as box with the VIOLIN's marks (what the stage it sends to draws)", () => {
    const s = spec("violin", false);
    const out = previewStatDraws(specToRender(s, [DS]), s, [DS], { box: { points: "none" }, violin: { points: "all" } });
    expect(out.flat && "marks" in out.flat && out.flat.marks?.points).toBe("all");
    expect(pointRows(out.flat)).toEqual([lotRows(0, null), lotRows(1, null)]);
  });

  it("points 'none' resolves no rows; no spec draws exactly the old, unmarked preview", () => {
    const s = spec("box", false);
    const r = specToRender(s, [DS]);
    const none = previewStatDraws(r, s, [DS], { box: { points: "none" } });
    expect(none.flat && "points" in none.flat ? none.flat.points : null).toBeNull();
    const legacy = previewStatDraws(r, null, [DS], {});
    if (r.kind !== "box") throw new Error("expected a box render");
    expect(legacy.flat).toEqual({ mode: "box", boxes: r.boxes, valueLabel: r.valueLabel, groupLabel: r.groupLabel });
  });
});

describe("previewStatDraws — bar", () => {
  it("faceted bars: each cell's raw points on ORIGINAL rows, the median summary", () => {
    const s = spec("bar", true);
    const out = previewStatDraws(specToRender(s, [DS]), s, [DS], { bar: { points: "all", summary: "median" } });
    out.facets!.forEach((f, w) => {
      if (f.draw.mode !== "bar") throw new Error("expected bar panels");
      expect(f.draw.marks).toMatchObject({ points: "all", summary: "median" });
      expect(f.draw.data.groups.map((g) => g.series[0].raw!.points.map((p) => p.rowIndex))).toEqual([
        lotRows(0, w), lotRows(1, w),
      ]);
    });
  });

  it("flat bar with a mean diamond only resolves no raw rows", () => {
    const s = spec("bar", false);
    const out = previewStatDraws(specToRender(s, [DS]), s, [DS], { bar: { summary: "mean" } });
    if (out.flat?.mode !== "bar") throw new Error("expected a bar draw");
    expect(out.flat.marks?.summary).toBe("mean");
    expect(out.flat.data.groups.every((g) => g.series.every((c) => c.raw == null))).toBe(true);
  });
});
