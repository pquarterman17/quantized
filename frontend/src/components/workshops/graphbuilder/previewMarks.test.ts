// JMP_GAP J5 residual (closed 2026-09-29): the Graph Builder's box / violin /
// bar PREVIEW draws the window's categorical marks (`PlotView.statMarks`, the
// same per-mode options the Stat Stage it sends to reads) — raw points with
// ORIGINAL rows (so a point's jitter is the stage's and the export's),
// summary marker, error bars — flat and per facet panel. Without a spec it
// draws exactly what it did before (no marks).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { facetSlices, facetSliceRowIds } from "../../../lib/facet";
import type { PlotSpec } from "../../../lib/plotspec";
import { specToRender } from "../../../lib/plotspec";
import { analysisView } from "../../../lib/rowstate";
import type { DataStruct, Dataset } from "../../../lib/types";
import { decorateDraw, levelAxes } from "../../Stage/statStageLevels";
import { previewStatDraws } from "./previewMarks";

/** The stage's defaults (`defaultPlotView`): empty levels shown, n captions on. */
const SHOW_ALL = { hideEmpty: false, showN: true };

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
    const out = previewStatDraws(specToRender(s, [DS]), s, [DS], { box: { points: "all", summary: "mean" } }, SHOW_ALL);
    expect(out.flat?.mode).toBe("box");
    expect(out.flat && "marks" in out.flat && out.flat.marks).toMatchObject({ points: "all", summary: "mean" });
    expect(pointRows(out.flat)).toEqual([lotRows(0, null), lotRows(1, null)]);
  });

  it("faceted box: every panel's points carry its own ORIGINAL rows (facetSliceRowIds), and its connect line", () => {
    const s = spec("box", true);
    const out = previewStatDraws(specToRender(s, [DS]), s, [DS], { box: { points: "all", connectMeans: true } }, SHOW_ALL);
    expect(out.facets?.map((f) => f.label)).toHaveLength(2);
    out.facets!.forEach((f, w) => {
      expect(pointRows(f.draw)).toEqual([lotRows(0, w), lotRows(1, w)]);
      expect("marks" in f.draw && f.draw.marks).toMatchObject({ points: "all", connectMeans: true });
    });
    // The one recipe, not a re-derivation: the same rows facetSliceRowIds gives.
    const { data, rowIds } = analysisView(DS);
    const slice = facetSlices(data!, 1)[0];
    expect(pointRows(out.facets![0].draw).flat().sort((a, b) => a - b)).toEqual(facetSliceRowIds(slice, rowIds));
  });

  it("violin previews as box with the VIOLIN's marks (what the stage it sends to draws)", () => {
    const s = spec("violin", false);
    const out = previewStatDraws(specToRender(s, [DS]), s, [DS], { box: { points: "none" }, violin: { points: "all" } }, SHOW_ALL);
    expect(out.flat && "marks" in out.flat && out.flat.marks?.points).toBe("all");
    expect(pointRows(out.flat)).toEqual([lotRows(0, null), lotRows(1, null)]);
  });

  it("points 'none' resolves no rows; no spec draws exactly the old, unmarked preview", () => {
    const s = spec("box", false);
    const r = specToRender(s, [DS]);
    const none = previewStatDraws(r, s, [DS], { box: { points: "none" } }, SHOW_ALL);
    expect(none.flat && "points" in none.flat ? none.flat.points : null).toBeNull();
    const legacy = previewStatDraws(r, null, [DS], {}, SHOW_ALL);
    if (r.kind !== "box") throw new Error("expected a box render");
    expect(legacy.flat).toEqual({ mode: "box", boxes: r.boxes, valueLabel: r.valueLabel, groupLabel: r.groupLabel });
  });
});

describe("previewStatDraws — bar", () => {
  it("faceted bars: each cell's raw points on ORIGINAL rows, the median summary", () => {
    const s = spec("bar", true);
    const out = previewStatDraws(specToRender(s, [DS]), s, [DS], { bar: { points: "all", summary: "median" } }, SHOW_ALL);
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
    const out = previewStatDraws(specToRender(s, [DS]), s, [DS], { bar: { summary: "mean" } }, SHOW_ALL);
    if (out.flat?.mode !== "bar") throw new Error("expected a bar draw");
    expect(out.flat.marks?.summary).toBe("mean");
    expect(out.flat.data.groups.every((g) => g.series.every((c) => c.raw == null))).toBe(true);
  });
});

// P2.6 box 2 leftover: the preview keeps EMPTY levels as empty slots, exactly
// as the Stat Stage (whose decoration it reuses: `Stage/statStageLevels`) and
// the export do — screen == preview == export. The fixture is the levels-
// parity one (`statLevelsParity.test.ts` / `tests/fixtures/wire/
// statplot_levels_export.json`): A 12 rows, B 2, C declared only, D all NaN,
// E all excluded.
const WIRE = join(dirname(fileURLToPath(import.meta.url)), "../../../../../tests/fixtures/wire/statplot_levels_export.json");
const A = Array.from({ length: 12 }, (_, i) => [0, i + 1]);
const LEVELS: DataStruct = {
  time: Array.from({ length: 18 }, (_, i) => i),
  values: [...A, [1, 10], [1, 12], [3, Number.NaN], [3, Number.NaN], [4, 20], [4, 21]],
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B", "C", "D", "E"] },
};
const LDS: Dataset = { id: "parity", name: "parity.csv", data: LEVELS, excludedRows: [16, 17] };
const lref = (channel: number) => ({ datasetId: "parity", channel });
const lspec = (mark: PlotSpec["mark"]): PlotSpec => ({
  version: 1,
  zones: { x: lref(0), y: [lref(1)], group: null, facet: null, yErr: [], xErr: null },
  mark,
});

describe("previewStatDraws — empty levels keep their slots (screen == preview == export)", () => {
  const fixture = JSON.parse(readFileSync(WIRE, "utf-8")) as { labels: string[]; data: number[][] };

  it("box: a declared-only, an all-NaN and an all-excluded level are empty slots, as the export's axis", () => {
    const s = lspec("box");
    const out = previewStatDraws(specToRender(s, [LDS]), s, [LDS], {}, SHOW_ALL);
    const d = out.flat;
    if (d?.mode !== "box" || !d.slots) throw new Error("expected a slotted box draw");
    expect(d.slots.map((x) => x.label)).toEqual(fixture.labels);
    expect(d.slots.map((x) => (x.group === null ? 0 : d.boxes[x.group].n))).toEqual(fixture.data.map((g) => g.length));
    expect(d.showN).toBe(true);
    // The stage's own decoration, not a second recipe.
    const axes = levelAxes({
      active: LDS, data: analysisView(LDS).data, mode: "box", groupCol: 0, group2Col: null, valueCol: 1,
      plotted: [1], barValueChannels: [1], facetCol: null, slices: null,
    });
    const undecorated = previewStatDraws(specToRender(s, [LDS]), null, [LDS], {}, SHOW_ALL).flat!;
    const stage = decorateDraw(undecorated, axes!.flat, false, true).draw;
    expect(d.slots).toEqual(stage.mode === "box" ? stage.slots : null);
  });

  it("hide-empty closes them up and n captions follow the option, as on the stage", () => {
    const s = lspec("box");
    const out = previewStatDraws(specToRender(s, [LDS]), s, [LDS], {}, { hideEmpty: true, showN: false });
    const d = out.flat;
    if (d?.mode !== "box" || !d.slots) throw new Error("expected a slotted box draw");
    expect(d.slots.map((x) => x.label)).toEqual(["grp = A", "grp = B"]);
    expect(d.showN).toBe(false);
  });

  it("bar: the empty categories are padded in as n=0 slots", () => {
    const s = lspec("bar");
    const out = previewStatDraws(specToRender(s, [LDS]), s, [LDS], {}, SHOW_ALL);
    const d = out.flat;
    if (d?.mode !== "bar") throw new Error("expected a bar draw");
    expect(d.data.groups.map((g) => g.label)).toEqual(["A", "B", "C", "D", "E"]);
    expect(d.data.groups.map((g) => g.series[0].n)).toEqual([12, 2, 0, 0, 0]);
    expect(d.slots?.map((x) => x.group)).toEqual([0, 1, null, null, null]);
  });

  it("faceted: a level absent from one panel is that panel's empty slot", () => {
    // lot x wafer: L2 occurs only in W1, so W2's panel has L2 as an empty slot.
    const rows = [[0, 0, 1], [0, 0, 2], [0, 1, 3], [0, 1, 4], [1, 0, 10], [1, 0, 11]];
    const ds: Dataset = {
      id: "fx", name: "fx.csv",
      data: {
        time: rows.map((_, i) => i), values: rows, labels: ["lot", "wafer", "y"], units: ["", "", ""], metadata: {},
        cat_levels: { 0: ["L1", "L2"], 1: ["W1", "W2"] },
      },
    };
    const s: PlotSpec = {
      version: 1,
      zones: { x: { datasetId: "fx", channel: 0 }, y: [{ datasetId: "fx", channel: 2 }], group: null,
        facet: { datasetId: "fx", channel: 1 }, yErr: [], xErr: null },
      mark: "box",
    };
    const out = previewStatDraws(specToRender(s, [ds]), s, [ds], {}, SHOW_ALL);
    expect(out.facets?.map((f) => f.label)).toEqual(["W1", "W2"]);
    const slots = out.facets!.map((f) => (f.draw.mode === "box" ? f.draw.slots : null));
    expect(slots.map((p) => p?.map((x) => x.label))).toEqual([["lot = L1", "lot = L2"], ["lot = L1", "lot = L2"]]);
    expect(slots.map((p) => p?.map((x) => x.group))).toEqual([[0, 1], [0, null]]);
  });

  it("without a spec the preview is undecorated, as before", () => {
    const s = lspec("box");
    const d = previewStatDraws(specToRender(s, [LDS]), null, [LDS], {}, SHOW_ALL).flat;
    expect(d !== null && "slots" in d).toBe(false);
  });
});
