// Review findings on lib/linkedCurves.ts (pure): 8 (assembly work is per
// block, not per curve x row), 9 (a malformed saved curve keeps its slot),
// 10 (Plot together honours designations: each Y on its own X), 11 (curve
// labels follow the source name), 13 (perSeriesX cache key includes xKey).

import { describe, expect, it } from "vitest";

import { assembleLinkedCurves, curvesForDatasets, sanitizeLinkedCurves } from "./linkedCurves";
import { perSeriesXData } from "./perSeriesX";
import type { Dataset, LinkedCurve } from "./types";

const N = 200;
const wide = (id: string, cols: number): Dataset => ({
  id,
  name: id,
  data: {
    time: Array.from({ length: N }, (_, i) => i),
    values: Array.from({ length: N }, (_, i) => Array.from({ length: cols }, (_, c) => i * 10 + c)),
    labels: Array.from({ length: cols }, (_, c) => `c${c}`),
    units: Array.from({ length: cols }, () => ""),
    metadata: {},
  },
});

/** The dataset with its `values` rows instrumented: how many times each source row is read. */
function counted(ds: Dataset): { ds: Dataset; reads: () => number } {
  let n = 0;
  const values = new Proxy(ds.data.values, {
    get(t, k, r) {
      if (typeof k === "string" && /^\d+$/.test(k)) n++;
      return Reflect.get(t, k, r);
    },
  });
  return { ds: { ...ds, data: { ...ds.data, values } }, reads: () => n };
}

describe("finding 8: assembly work is bounded by rows, not rows x curves", () => {
  it("allocates exactly one row per block row, whatever the curve count", () => {
    for (const k of [1, 5, 20]) {
      const src = wide("s", k);
      const curves = Array.from({ length: k }, (_, c): LinkedCurve => ({ datasetId: "s", xKey: null, yKey: c, label: `c${c}` }));
      const out = assembleLinkedCurves(curves, [src]);
      expect(out.time).toHaveLength(N);
      expect(out.values).toHaveLength(N);
    }
  });

  it("reads each source row once per block, not once per curve", () => {
    const k = 20;
    const { ds, reads } = counted(wide("s", k));
    const curves = Array.from({ length: k }, (_, c): LinkedCurve => ({ datasetId: "s", xKey: null, yKey: c, label: `c${c}` }));
    const out = assembleLinkedCurves(curves, [ds]);
    expect(reads()).toBeLessThanOrEqual(N); // pre-fix: N x k
    expect(out.values[7].slice(0, 3)).toEqual([70, 71, 72]); // layout unchanged
  });

  it("many sources: rows are the sum of block rows and each cell sits inside its own block", () => {
    const srcs = [wide("a", 1), wide("b", 1), wide("c", 1)];
    const curves = srcs.map((s): LinkedCurve => ({ datasetId: s.id, xKey: null, yKey: 0, label: s.id }));
    const out = assembleLinkedCurves(curves, srcs);
    expect(out.values).toHaveLength(3 * N);
    out.values.forEach((row, r) => row.forEach((v, c) => expect(Number.isNaN(v)).toBe(Math.floor(r / N) !== c)));
  });
});

describe("finding 9: sanitizeLinkedCurves keeps slots", () => {
  it("a malformed entry stays as an empty curve so later curves keep their column", () => {
    const out = sanitizeLinkedCurves([
      { datasetId: "a", xKey: null, yKey: 0, label: "A" },
      { datasetId: 5, xKey: null, yKey: 0, label: "bad" },
      { datasetId: "b", xKey: null, yKey: 0, label: "B" },
    ])!;
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ datasetId: "b", xKey: null, yKey: 0, label: "B" });
    expect(out[1].yKey).toBe(-1);
    expect(out[1].datasetId).not.toBe("a");
    expect(out[1].label).toBe("bad");
  });
  it("still returns undefined for a non-array or an empty list", () => {
    expect(sanitizeLinkedCurves("x")).toBeUndefined();
    expect(sanitizeLinkedCurves([])).toBeUndefined();
  });
});

describe("finding 10: Plot together honours designations", () => {
  const sheet: Dataset = {
    id: "s",
    name: "S",
    data: {
      time: [1, 2, 3],
      values: [[10, 5, 100], [20, 3, 200], [30, 9, 300]],
      labels: ["R1", "T2", "R2"],
      units: ["", "", ""],
      metadata: {},
    },
    columnDesignations: { 1: "X" },
  };
  const plain: Dataset = { id: "p", name: "P", data: { time: [1, 2], values: [[1], [2]], labels: ["Y"], units: [""], metadata: {} } };

  it("never plots a designated X as a Y; each Y carries its own X", () => {
    const curves = curvesForDatasets([sheet, plain], (d) => (d.id === "s" ? 1 /* a primary that is the X column */ : 0));
    expect(curves.map((c) => [c.datasetId, c.xKey, c.yKey])).toEqual([["s", null, 0], ["s", 1, 2], ["p", null, 0]]);
    expect(curves[0].label).toBe("S: R1");
    expect(curves[2].label).toBe("P");
    const g = assembleLinkedCurves(curves, [sheet, plain]);
    const r2 = g.values.map((row, r) => [g.time[r], row[1]]).filter(([, v]) => Number.isFinite(v));
    expect(r2).toEqual([[5, 100], [3, 200], [9, 300]]); // R2 on T2, in row order
  });
});

describe("finding 11: labels follow the source name", () => {
  it("a curve without a user label is named from the CURRENT source name", () => {
    const src = wide("s", 1);
    const curves: LinkedCurve[] = [{ datasetId: "s", xKey: null, yKey: 0, label: "s", labelFrom: "name" }];
    expect(assembleLinkedCurves(curves, [src]).labels).toEqual(["s"]);
    expect(assembleLinkedCurves(curves, [{ ...src, name: "renamed" }]).labels).toEqual(["renamed"]);
    expect(assembleLinkedCurves([{ ...curves[0], labelFrom: "nameCol" }], [{ ...src, name: "renamed" }]).labels).toEqual(["renamed: c0"]);
  });
  it("a user-typed label (no labelFrom) is never overwritten", () => {
    const src = wide("s", 1);
    const out = assembleLinkedCurves([{ datasetId: "s", xKey: null, yKey: 0, label: "mine" }], [{ ...src, name: "renamed" }]);
    expect(out.labels).toEqual(["mine"]);
  });
  it("labelFrom survives a .dwk round trip", () => {
    const out = sanitizeLinkedCurves([{ datasetId: "a", xKey: null, yKey: 0, label: "A", labelFrom: "name" }])!;
    expect(out[0].labelFrom).toBe("name");
  });
});

describe("finding 13: perSeriesXData cache is keyed by the plot X too", () => {
  const ds: Dataset = {
    id: "m",
    name: "m",
    data: { time: [1, 2, 3], values: [[10, 5, 100], [20, 3, 200], [30, 9, 300]], labels: ["R1", "T2", "R2"], units: ["", "", ""], metadata: {} },
    columnDesignations: { 1: "X" },
  };
  it("the same dataset under xKey null and xKey 1 gets different views", () => {
    const a = perSeriesXData(ds, null)!;
    const b = perSeriesXData(ds, 1)!;
    expect(a.blocks).toEqual([null, 1]);
    expect(b.blocks).toEqual([1, null]);
    expect(b.data.time.slice(0, 3)).toEqual([5, 3, 9]);
    expect(perSeriesXData(ds, null)!.data.time.slice(0, 3)).toEqual([1, 2, 3]);
  });
});
