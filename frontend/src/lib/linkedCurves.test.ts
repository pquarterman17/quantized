// Gap audit 2 #1: the pure half of LIVE multi-dataset graphs -- assembly,
// dependency order, persistence and remapping. Non-monotonic X on purpose:
// a block keeps its source's acquisition order, never a sorted union.

import { describe, expect, it } from "vitest";

import {
  assembleLinkedCurves,
  defaultCurves,
  graphBuildOrder,
  nextGraphName,
  reachesGraph,
  relabelCurveColumns,
  remapCurveColumns,
  remapCurveSources,
  sanitizeLinkedCurves,
  UNRESOLVED_SOURCE,
  type LinkedCurve,
} from "./linkedCurves";
import type { Dataset } from "./types";

const loop = (id: string, name: string, xs: number[], ys: number[], extra: Partial<Dataset> = {}): Dataset => ({
  id,
  name,
  data: {
    time: xs,
    values: ys.map((y) => [y, y * 10]),
    labels: ["Moment", "Moment2"],
    units: ["emu", "emu"],
    metadata: { x_column_name: "Field", x_column_unit: "Oe" },
  },
  ...extra,
});
const A = loop("a", "Sample A", [3, 1, 2], [30, 10, 20]);
const B = loop("b", "Sample B", [5, 4], [50, 40]);
const lookupOf = (...ds: Dataset[]) => (id: string) => ds.find((d) => d.id === id);
const curve = (datasetId: string, yKey = 0, xKey: number | null = null): LinkedCurve => ({ datasetId, xKey, yKey });

/** The finite (x, y) pairs of column `c`. */
const pairs = (d: { time: number[]; values: number[][] }, c: number) =>
  d.values.flatMap((row, i) => (Number.isFinite(row[c]) ? [[d.time[i], row[c]]] : []));

describe("assembleLinkedCurves", () => {
  it("one block per (source, X), row order kept, values only in a curve's own block", () => {
    const d = assembleLinkedCurves([curve("a"), curve("b")], lookupOf(A, B));
    expect(d.time).toEqual([3, 1, 2, 5, 4]);
    expect(pairs(d, 0)).toEqual([[3, 30], [1, 10], [2, 20]]);
    expect(pairs(d, 1)).toEqual([[5, 50], [4, 40]]);
    // The Y title names the quantity; the legend names the source.
    expect(d.labels).toEqual(["Moment", "Moment"]);
    expect(d.units).toEqual(["emu", "emu"]);
    expect(d.metadata.linked_curve_legends).toEqual(["Sample A", "Sample B"]);
    expect(d.metadata.x_column_long).toBe("Field");
    expect(d.metadata.x_column_unit).toBe("Oe");
  });

  it("builds each block once, for its own curves: rows = sum of block rows (review finding 8)", () => {
    const d = assembleLinkedCurves([curve("a", 0), curve("a", 1), curve("b", 0)], lookupOf(A, B));
    expect(d.time).toHaveLength(3 + 2);
    expect(d.values).toHaveLength(5);
    expect(d.metadata.linked_curve_legends).toEqual(["Sample A: Moment", "Sample A: Moment2", "Sample B"]);
  });

  it("a masked or filtered source row is a NaN gap in Y only", () => {
    const masked = { ...A, excludedRows: [1] };
    const d = assembleLinkedCurves([curve("a")], lookupOf(masked));
    expect(d.time).toEqual([3, 1, 2]);
    expect(pairs(d, 0)).toEqual([[3, 30], [2, 20]]);
  });

  it("a missing source or column is an empty curve, never rebound to another (fail closed)", () => {
    const d = assembleLinkedCurves([curve("gone"), curve("a", 7), curve("b", -1), curve("a")], lookupOf(A, B));
    expect(d.time).toEqual([3, 1, 2]); // only A's block exists
    for (const c of [0, 1, 2]) expect(pairs(d, c)).toEqual([]);
    expect(pairs(d, 3)).toEqual([[3, 30], [1, 10], [2, 20]]);
  });

  it("own X follows the source's designations (nearest-preceding X)", () => {
    const sheet: Dataset = {
      id: "s",
      name: "sheet",
      data: { time: [300, 100], values: [[3, 30, 33], [1, 10, 11]], labels: ["R1", "T2", "R2"], units: ["ohm", "K", "ohm"], metadata: { x_column_name: "T1", x_column_unit: "K" } },
      columnDesignations: { 1: "X" },
    };
    const d = assembleLinkedCurves([curve("s", 0), curve("s", 2)], lookupOf(sheet));
    expect(pairs(d, 0)).toEqual([[300, 3], [100, 1]]);
    expect(pairs(d, 1)).toEqual([[30, 33], [10, 11]]);
    expect(d.metadata.x_column_long).toBe("T1 / T2");
    expect(d.metadata.x_column_unit).toBe("K");
  });

  it("mixed X units name each quantity with its own unit", () => {
    const sweep: Dataset = { ...B, data: { ...B.data, metadata: { x_column_name: "Temperature", x_column_unit: "K" } } };
    const d = assembleLinkedCurves([curve("a"), curve("b")], lookupOf(A, sweep));
    expect(d.metadata.x_column_long).toBe("Field (Oe) / Temperature (K)");
    expect(d.metadata.x_column_unit).toBe("");
  });

  it("a user label wins; otherwise the legend follows the source's CURRENT name", () => {
    expect(assembleLinkedCurves([{ ...curve("a"), label: "mine" }], lookupOf(A)).metadata.linked_curve_legends).toEqual(["mine"]);
    const renamed = { ...A, name: "Renamed" };
    expect(assembleLinkedCurves([curve("a")], lookupOf(renamed)).metadata.linked_curve_legends).toEqual(["Renamed"]);
  });
});

describe("graph dependencies", () => {
  const graph = (id: string, ...sources: string[]): Dataset => ({
    id, name: id, data: { time: [], values: [], labels: [], units: [], metadata: {} }, linkedCurves: sources.map((s) => curve(s)),
  });

  it("orders a graph after the graphs it sources", () => {
    const g1 = graph("g1", "a");
    const g2 = graph("g2", "g1");
    const { order, cyclic } = graphBuildOrder([g2, A, g1]);
    expect(order.map((d) => d.id)).toEqual(["g1", "g2"]);
    expect(cyclic.size).toBe(0);
  });

  it("marks every graph on a cycle (and a self-loop) cyclic, terminating", () => {
    const { cyclic } = graphBuildOrder([graph("g1", "g2"), graph("g2", "g1"), graph("g3", "g3"), graph("g4", "g1")]);
    expect([...cyclic].sort()).toEqual(["g1", "g2", "g3"]);
  });

  it("reachesGraph: a source whose curves reach the target (transitively) is refused", () => {
    const all = [A, graph("g1", "a"), graph("g2", "g1")];
    expect(reachesGraph("g2", "g1", all)).toBe(true);
    expect(reachesGraph("g1", "g1", all)).toBe(true);
    expect(reachesGraph("a", "g1", all)).toBe(false);
    expect(reachesGraph("g1", "g2", all)).toBe(false);
  });
});

describe("persistence and remapping", () => {
  it("a malformed curve keeps its slot as an unresolvable one (review finding 9)", () => {
    const out = sanitizeLinkedCurves([curve("a"), { datasetId: 5 }, "junk", { datasetId: "b", yKey: 1, xKey: -3 }, { ...curve("b", 1), label: "L" }]);
    expect(out).toHaveLength(5);
    expect(out![0]).toEqual(curve("a"));
    expect(out![1].yKey).toBe(-1);
    expect(out![2]).toEqual({ datasetId: UNRESOLVED_SOURCE, xKey: null, yKey: -1 });
    expect(out![3].yKey).toBe(-1);
    expect(out![4]).toEqual({ ...curve("b", 1), label: "L" });
    expect(sanitizeLinkedCurves("nope")).toBeUndefined();
  });

  it("a merged .dwk's ids are followed; an unmapped source draws empty (review finding 2)", () => {
    const out = remapCurveSources([curve("a"), curve("x")], new Map([["a", "a2"]]));
    expect(out.map((c) => c.datasetId)).toEqual(["a2", UNRESOLVED_SOURCE]);
    const d = assembleLinkedCurves(out, (id) => (id === "a2" ? { ...A, id: "a2" } : id === "" ? A : undefined));
    expect(pairs(d, 1)).toEqual([]);
  });

  it("column edits on the source follow the columns; a deleted Y or X kills the curve", () => {
    const curves = [curve("a", 0), curve("a", 2, 1), curve("b", 0)];
    const deleted = (c: number) => (c === 1 ? -1 : c > 1 ? c - 1 : c);
    expect(remapCurveColumns(curves, "a", deleted)).toEqual([curve("a", 0), { datasetId: "a", xKey: null, yKey: -1 }, curve("b", 0)]);
    const inserted = (c: number) => c + 1;
    expect(remapCurveColumns(curves, "a", inserted)).toEqual([curve("a", 1), curve("a", 3, 2), curve("b", 0)]);
  });

  it("a re-import re-finds columns by label; a missing or ambiguous label kills the curve (review finding 4)", () => {
    const curves = [curve("a", 0), curve("a", 1), curve("a", 2)];
    const out = relabelCurveColumns(curves, "a", ["M", "T", "R"], ["T", "New", "M", "R", "R"]);
    expect(out.map((c) => c.yKey)).toEqual([2, 0, -1]);
  });
});

describe("creation", () => {
  it("names graphs Origin-style, unique", () => {
    expect(nextGraphName([])).toBe("Graph1");
    expect(nextGraphName([{ name: "Graph1" }, { name: "Graph3" }])).toBe("Graph2");
  });

  it("Plot together honours designations and own X (review finding 10)", () => {
    const sheet: Dataset = {
      id: "s",
      name: "sheet",
      data: { time: [0, 1], values: [[3, 30, 33, 0.1], [1, 10, 11, 0.1]], labels: ["R1", "T2", "R2", "dR2"], units: ["", "", "", ""], metadata: {} },
      columnDesignations: { 1: "X", 3: "Y-error" },
    };
    expect(defaultCurves(sheet)).toEqual([curve("s", 0), curve("s", 2)]);
    // No designations: the one channel the default plot leads with.
    expect(defaultCurves(A)).toEqual([curve("a", 0)]);
  });
});
