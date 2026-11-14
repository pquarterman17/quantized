// Gap audit 2 #1: a LIVE graph follows its sources. The sync rebuilds a graph
// when an input changes -- and only then -- never recursing inside the store
// listener, and a graph-of-graphs cycle (which a hand-made .dwk can carry)
// draws empty instead of overflowing the stack (review finding 1).

import { beforeEach, describe, expect, it } from "vitest";

import type { LinkedCurve } from "../lib/linkedCurves";
import type { Dataset } from "../lib/types";
import { installLinkedCurvesSync, rebuildLinkedGraphs, resetLinkedCurvesSyncForTests } from "./linkedCurvesSync";
import { useApp } from "./useApp";

const src = (id: string, ys: number[]): Dataset => ({
  id,
  name: id.toUpperCase(),
  data: { time: ys.map((_, i) => i), values: ys.map((y) => [y]), labels: ["M"], units: ["emu"], metadata: {} },
});
const curve = (datasetId: string): LinkedCurve => ({ datasetId, xKey: null, yKey: 0 });
const graph = (id: string, ...sources: string[]): Dataset => ({
  id,
  name: id,
  data: { time: [], values: [], labels: [], units: [], metadata: {} },
  linkedCurves: sources.map(curve),
});
const get = (id: string) => useApp.getState().datasets.find((d) => d.id === id)!;
const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const ys = (d: Dataset, c = 0) => d.data.values.map((row) => row[c]).filter(Number.isFinite);

beforeEach(() => {
  resetLinkedCurvesSyncForTests();
  useApp.setState({ datasets: [src("a", [1, 2]), src("b", [5]), graph("g", "a", "b")] });
  installLinkedCurvesSync();
});

describe("linkedCurvesSync", () => {
  it("builds the graph on install (a loaded .dwk re-links) and follows a source edit", async () => {
    expect(ys(get("g"), 0)).toEqual([1, 2]);
    expect(ys(get("g"), 1)).toEqual([5]);
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, data: { ...d.data, values: [[7], [8]] } } : d)),
    }));
    await settle();
    expect(ys(get("g"), 0)).toEqual([7, 8]);
  });

  it("rebuilds only when an input changes", async () => {
    const before = get("g").data;
    useApp.setState({ status: "unrelated" });
    useApp.setState((s) => ({ datasets: [...s.datasets] })); // new array, same datasets
    await settle();
    expect(get("g").data).toBe(before);
  });

  it("a source's row state and channel types are inputs (review finding 5)", async () => {
    const before = get("g").data;
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, channelTypes: { 0: "nominal" } } : d)) }));
    await settle();
    expect(get("g").data).not.toBe(before);
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, excludedRows: [0] } : d)) }));
    await settle();
    expect(ys(get("g"), 0)).toEqual([2]);
  });

  it("a renamed source renames its curve's legend", async () => {
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, name: "Renamed" } : d)) }));
    await settle();
    expect(get("g").data.metadata.linked_curve_legends).toEqual(["Renamed", "B"]);
  });

  it("a graph-of-graphs sees this pass's rebuild of the graph it sources", async () => {
    useApp.setState((s) => ({ datasets: [...s.datasets, graph("h", "g")] }));
    await settle();
    expect(ys(get("h"), 0)).toEqual([1, 2]);
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, data: { ...d.data, values: [[9], [9]] } } : d)),
    }));
    await settle();
    expect(ys(get("h"), 0)).toEqual([9, 9]);
  });

  it("a G1<->G2 cycle draws empty and settles: no recursion, no ping-pong", async () => {
    useApp.setState({ datasets: [src("a", [1]), { ...graph("g1", "a", "g2") }, graph("g2", "g1")] });
    await settle();
    await settle();
    const g1 = get("g1").data;
    const g2 = get("g2").data;
    expect(g1.values.flat().filter(Number.isFinite)).toEqual([]);
    expect(g2.values.flat().filter(Number.isFinite)).toEqual([]);
    // Settled: another pass changes nothing.
    rebuildLinkedGraphs();
    await settle();
    expect(get("g1").data).toBe(g1);
    expect(get("g2").data).toBe(g2);
    // ...and the app keeps working.
    useApp.setState((s) => ({ datasets: [...s.datasets, src("c", [3])] }));
    await settle();
    expect(get("c")).toBeDefined();
  });
});
