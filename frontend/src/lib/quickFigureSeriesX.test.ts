// Per-series X (LIBRARY_WORKBOOK_UX_PLAN: `X, Y, X, Y, X, Y` and "multiple
// independent X channels"): the pure overlay, the preview drawn from it, the
// point labels, and the mapping inference/edits that produce it.
import { describe, expect, it } from "vitest";

import { quickFigurePointLabels } from "./quickFigureLabels";
import type { QuickFigureMapping } from "./quickFigureMapping";
import {
  assignQuickFigureColumn,
  assignSeriesX,
  assignmentFor,
  initialQuickFigureMapping,
  seriesXCandidates,
  useAcquisitionAxis,
} from "./quickFigureMappingActions";
import { quickFigurePreview } from "./quickFigurePreview";
import { quickFigureOverlay, seriesXKey, usesPerSeriesX } from "./quickFigureSeriesX";
import type { DataStruct, Dataset } from "./types";

// `X1,Y1,X2,Y2,X3,Y3`: the first X is the acquisition axis, so the value
// channels are Y1(0) X2(1) Y2(2) X3(3) Y3(4). X3 is a hysteresis-like sweep
// (0 -> 2 -> 0 -> -2 -> 0): non-monotonic, and its row order is the physics.
const X1 = [0, 1, 2, 3, 4];
const X2 = [10, 20, 30, 40, 50];
const X3 = [0, 2, 0, -2, 0];
const Y1 = [1, 2, 3, 4, 5];
const Y2 = [100, 200, 300, 400, 500];
const Y3 = [-1, 1, 1.5, -1, -1.5];
const xyxy: DataStruct = {
  time: X1,
  values: X1.map((_, r) => [Y1[r], X2[r], Y2[r], X3[r], Y3[r]]),
  labels: ["Y1", "X2", "Y2", "X3", "Y3"],
  units: ["V", "Oe", "V", "Oe", "V"],
  metadata: { x_column_long: "X1", x_column_unit: "Oe" },
};
const ownX: QuickFigureMapping = { xKey: null, xKeyByY: { 2: 1, 4: 3 }, yKeys: [0, 2, 4], errorBindings: [], ignoredKeys: [] };

/** The (x, y) points one payload series actually draws, in row order. */
function drawn(data: (number | null)[][], series: number): [number, number][] {
  const out: [number, number][] = [];
  data[0].forEach((x, r) => {
    const y = data[series + 1][r];
    if (x != null && y != null) out.push([x, y]);
  });
  return out;
}
const zip = (xs: number[], ys: number[]): [number, number][] => xs.map((x, r) => [x, ys[r]]);

describe("quickFigureOverlay — each Y against its own X, in acquisition order", () => {
  it("X1,Y1,X2,Y2,X3,Y3: one block per X, each series finite only in its own block", () => {
    const overlay = quickFigureOverlay(xyxy, ownX)!;
    expect(overlay.blocks).toEqual([null, 1, 3]);
    expect(overlay.data.time).toEqual([...X1, ...X2, ...X3]); // segments, never a sorted union
    expect(overlay.data.labels).toEqual(["Y1", "Y2", "Y3"]);
    expect(overlay.mapping).toEqual({ xKey: null, yKeys: [0, 1, 2], errorBindings: [], ignoredKeys: [] });
    const col = (c: number) => overlay.data.values.map((row) => row[c]);
    const nan = [NaN, NaN, NaN, NaN, NaN];
    expect(col(0)).toEqual([...Y1, ...nan, ...nan]);
    expect(col(1)).toEqual([...nan, ...Y2, ...nan]);
    expect(col(2)).toEqual([...nan, ...nan, ...Y3]);
    expect(overlay.data.metadata).toMatchObject({ x_column_long: "X1 / X2 / X3", x_column_unit: "Oe" });
  });

  it("the preview draws every series against its own X, non-monotonic X in original row order", () => {
    const render = quickFigurePreview(xyxy, ownX, "line");
    expect(render.kind).toBe("xy");
    if (render.kind !== "xy") return;
    const data = render.payload.data as (number | null)[][];
    expect(render.payload.series.map((s) => s.label)).toEqual(["Y1", "Y2", "Y3"]);
    expect(drawn(data, 0)).toEqual(zip(X1, Y1));
    expect(drawn(data, 1)).toEqual(zip(X2, Y2));
    expect(drawn(data, 2)).toEqual(zip(X3, Y3)); // 0,2,0,-2,0 -- the loop, unsorted
  });

  it("mixed: shared-X series stay together in one block, an override gets its own", () => {
    const mixed: QuickFigureMapping = { xKey: null, xKeyByY: { 4: 3 }, yKeys: [0, 2, 4], errorBindings: [], ignoredKeys: [] };
    expect(seriesXKey(mixed, 0)).toBeNull();
    expect(seriesXKey(mixed, 2)).toBeNull();
    expect(seriesXKey(mixed, 4)).toBe(3);
    const render = quickFigurePreview(xyxy, mixed, "scatter");
    if (render.kind !== "xy") throw new Error("expected an xy render");
    const data = render.payload.data as (number | null)[][];
    expect(data[0]).toEqual([...X1, ...X3]);
    expect(drawn(data, 0)).toEqual(zip(X1, Y1));
    expect(drawn(data, 1)).toEqual(zip(X1, Y2)); // Y2 on the SHARED X
    expect(drawn(data, 2)).toEqual(zip(X3, Y3));
  });

  it("a shared-X mapping needs no overlay and previews exactly as before", () => {
    const shared: QuickFigureMapping = { xKey: null, yKeys: [0, 2], errorBindings: [], ignoredKeys: [] };
    expect(usesPerSeriesX(shared)).toBe(false);
    expect(quickFigureOverlay(xyxy, shared)).toBeNull();
    // An override equal to the shared X is not "its own" X.
    expect(usesPerSeriesX({ ...shared, xKeyByY: { 2: null } })).toBe(false);
    const render = quickFigurePreview(xyxy, shared, "line");
    if (render.kind !== "xy") throw new Error("expected an xy render");
    expect(render.payload.data[0]).toEqual(X1);
  });

  it("Y error rides its target's block; X error only the shared-X block", () => {
    const data: DataStruct = {
      ...xyxy,
      values: xyxy.values.map((row, r) => [...row, 0.1 * (r + 1), 5]),
      labels: [...xyxy.labels, "dY3", "dX1"],
      units: [...xyxy.units, "V", "Oe"],
    };
    const mapping: QuickFigureMapping = {
      ...ownX,
      errorBindings: [
        { channel: 5, target: 4, axis: "y", side: "both" },
        { channel: 6, target: -1, axis: "x", side: "both" },
      ],
    };
    const overlay = quickFigureOverlay(data, mapping)!;
    expect(overlay.mapping.errorBindings).toEqual([
      { channel: 3, target: 2, axis: "y", side: "both" },
      { channel: 4, target: -1, axis: "x", side: "both" },
    ]);
    const col = (c: number) => overlay.data.values.map((row) => row[c]);
    expect(col(3).slice(10)).toEqual([0.1, 0.2, 0.30000000000000004, 0.4, 0.5]);
    expect(col(3).slice(0, 10).every(Number.isNaN)).toBe(true);
    expect(col(4).slice(0, 5)).toEqual([5, 5, 5, 5, 5]); // shared X (block 0) only
    expect(col(4).slice(5).every(Number.isNaN)).toBe(true);
    const render = quickFigurePreview(data, mapping, "line");
    if (render.kind !== "xy") throw new Error("expected an xy render");
    // Y3's whiskers sit on Y3's own points; Y2 (own X) draws no X bars.
    expect(render.errorSpans?.get(3)?.find((s) => s.axis === "y")?.plus.slice(10)).toEqual(col(3).slice(10));
    expect(render.errorSpans?.get(2)?.find((s) => s.axis === "x")?.plus.slice(5, 10)).toEqual([null, null, null, null, null]);
  });

  it("a Group by column repeats in every block with its levels re-keyed", () => {
    const data: DataStruct = {
      ...xyxy,
      values: xyxy.values.map((row, r) => [...row, r % 2]),
      labels: [...xyxy.labels, "sample"],
      units: [...xyxy.units, ""],
      cat_levels: { 5: ["A", "B"] },
    };
    const overlay = quickFigureOverlay(data, { ...ownX, groupKey: 5 })!;
    expect(overlay.mapping.groupKey).toBe(3);
    expect(overlay.data.cat_levels).toEqual({ 3: ["A", "B"] });
    expect(overlay.data.values.map((row) => row[3])).toEqual([0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0]);
    const render = quickFigurePreview(data, { ...ownX, groupKey: 5 }, "line");
    if (render.kind !== "xy") throw new Error("expected an xy render");
    expect(render.payload.series.map((s) => s.label)).toEqual([
      "Y1 (sample=A)", "Y1 (sample=B)", "Y2 (sample=A)", "Y2 (sample=B)", "Y3 (sample=A)", "Y3 (sample=B)",
    ]);
  });

  it("point labels sit at each series' own X", () => {
    const dataset: Dataset = {
      id: "p", name: "p", data: { ...xyxy, values: xyxy.values.map((row, r) => [...row, r]), labels: [...xyxy.labels, "n"], units: [...xyxy.units, ""] },
    };
    const labels = quickFigurePointLabels(dataset, { ...ownX, labelKey: 5 }, "g");
    // Row 3 of each series, at that series' own X.
    expect(labels.filter((a) => a.text === "3").map((a) => [a.x, a.y])).toEqual([[X1[3], Y1[3]], [X2[3], Y2[3]], [X3[3], Y3[3]]]);
  });
});

describe("per-series X in the mapping draft", () => {
  // The same sheet as imported from Origin: A (X) is `.time`, the rest carry
  // their worksheet designations.
  const origin: Dataset = {
    id: "o1",
    name: "Moke.opj",
    data: {
      ...xyxy,
      metadata: {
        ...xyxy.metadata,
        x_column_name: "A",
        origin_column_names: ["B", "C", "D", "E", "F"],
        column_designations: { A: "X", B: "Y", C: "X", D: "Y", E: "X", F: "Y" },
      },
    },
  };

  it("infers each Y's nearest-preceding X-designated column; a Y before any keeps the shared X", () => {
    const mapping = initialQuickFigureMapping(origin);
    expect(mapping).toEqual({ xKey: null, xKeyByY: { 2: 1, 4: 3 }, yKeys: [0, 2, 4], errorBindings: [], ignoredKeys: [] });
    expect(assignmentFor(mapping, 1)).toEqual({ role: "series-x", targets: [2] });
    expect(assignmentFor(mapping, 0)).toEqual({ role: "y" });
  });

  it("without X designations nothing is paired by adjacency, and the draft keeps its pre-multi-X shape", () => {
    const mapping = initialQuickFigureMapping({ id: "c", name: "xyxy.csv", data: xyxy });
    expect(mapping).not.toHaveProperty("xKeyByY");
    expect(mapping.yKeys).toEqual([0, 1, 2, 3, 4]);
  });

  it("an X designated but unused by any Y stays ignored", () => {
    const trailing: Dataset = {
      ...origin,
      data: { ...origin.data, metadata: { ...origin.data.metadata, column_designations: { A: "X", B: "Y", C: "Y", D: "Y", E: "Y", F: "X" } } },
    };
    const mapping = initialQuickFigureMapping(trailing);
    expect(mapping).not.toHaveProperty("xKeyByY");
    expect(mapping.ignoredKeys).toEqual([4]);
  });

  it("the user can reassign any Y's X; a shared choice, and a column leaving the role, fall back to the shared X", () => {
    const seeded = initialQuickFigureMapping(origin);
    // Y3 onto X2 as well: one X column now serves two series.
    const both = assignSeriesX(seeded, 4, 1);
    expect(both.xKeyByY).toEqual({ 2: 1, 4: 1 });
    expect(assignmentFor(both, 3)).toEqual({ role: "unassigned" }); // X3 left unused -- never made a Y
    expect(assignmentFor(both, 1)).toEqual({ role: "series-x", targets: [2, 4] });
    expect(assignSeriesX(both, 2, "shared").xKeyByY).toEqual({ 4: 1 });
    expect(assignSeriesX(assignSeriesX(both, 2, "shared"), 4, "shared")).not.toHaveProperty("xKeyByY");
    // X2 given another role: both of its series return to the shared X.
    const ignored = assignQuickFigureColumn(both, 1, { role: "ignore" });
    expect(ignored).not.toHaveProperty("xKeyByY");
    expect(ignored.ignoredKeys).toEqual([1]);
    // An ignored column adopted as a series X leaves Ignore.
    const adopted = assignSeriesX(ignored, 4, 1);
    expect(adopted.xKeyByY).toEqual({ 4: 1 });
    expect(adopted.ignoredKeys).toEqual([]);
    // Any column but the series itself (a CSV imports its X2 as a Y) ...
    expect(seriesXCandidates(adopted, 5, 4)).toEqual([null, 0, 1, 2, 3]);
    // ... and a Y picked as another series' X stops being plotted as a Y.
    const fromY = assignSeriesX(adopted, 4, 2);
    expect(fromY.yKeys).toEqual([0, 4]);
    expect(fromY.xKeyByY).toEqual({ 4: 2 });
    expect(assignSeriesX(adopted, 4, 4)).toBe(adopted); // never its own X
  });

  it("changing the shared X keeps each override distinct from it", () => {
    const seeded = initialQuickFigureMapping(origin);
    const shared = assignQuickFigureColumn(seeded, 3, { role: "x" }); // X3 becomes the shared X
    expect(shared.xKey).toBe(3);
    expect(shared.xKeyByY).toEqual({ 2: 1 }); // Y3's override now equals the shared X
    expect(useAcquisitionAxis(assignSeriesX(shared, 0, null))).toEqual({ ...shared, xKey: null, xKeyByY: { 2: 1 } });
  });
});
