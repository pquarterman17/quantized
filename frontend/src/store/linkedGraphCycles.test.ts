// Review finding 1: graph <-> graph curve references used to recurse forever
// (RangeError) in the sync watcher and brick the app. A source whose curves
// reach the target is refused at the add-curve entry points; and a cycle that
// arrives anyway (a hand-made .dwk) fails closed -- the graphs on it draw
// empty -- instead of looping. Chains (a graph of a graph) rebuild in
// topological order.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { linkedGraphReaches } from "../lib/linkedCurves";
import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import { appendCurve } from "../lib/plotSelectedTogetherRun";
import type { Dataset, LinkedCurve } from "../lib/types";
import { relinkedDatasets, watchLinkedCurves } from "./linkedCurvesSync";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

vi.mock("./paramDialog", () => ({ askParams: vi.fn() }));

const plain = (id: string, y: number[]): Dataset => ({
  id,
  name: id,
  data: { time: [1, 2, 3], values: y.map((v) => [v]), labels: ["Y"], units: ["V"], metadata: {} },
});
const curve = (datasetId: string, label = datasetId): LinkedCurve => ({ datasetId, xKey: null, yKey: 0, label });
const emptyData = { time: [], values: [], labels: [], units: [], metadata: {} };
const graphOf = (id: string, curves: LinkedCurve[]): Dataset => ({ id, name: id, data: emptyData, linkedCurves: curves });
const get = (id: string) => useApp.getState().datasets.find((d) => d.id === id)!;

beforeEach(() => {
  useApp.setState({ datasets: [plain("a", [1, 2, 3]), plain("b", [4, 5, 6])], selectedIds: [], history: [], future: [], activeId: null });
  useToasts.setState({ toasts: [] });
});

describe("linkedGraphReaches", () => {
  it("is transitive and self-aware", () => {
    const ds = [plain("a", [1]), graphOf("g1", [curve("a")]), graphOf("g2", [curve("g1")]), graphOf("g3", [curve("b")])];
    expect(linkedGraphReaches(ds, "g2", "a")).toBe(true);
    expect(linkedGraphReaches(ds, "g2", "g2")).toBe(true);
    expect(linkedGraphReaches(ds, "g3", "a")).toBe(false);
    expect(linkedGraphReaches(ds, "a", "g1")).toBe(false);
  });
});

describe("refusing a cycle at the entry point", () => {
  it("G1 <- G2 is allowed, G2 <- G1 is refused with a message and the app keeps working", async () => {
    await plotSelectedTogether(["a", "b"]);
    await plotSelectedTogether(["a", "b"]);
    const [g1, g2] = useApp.getState().datasets.filter((d) => d.linkedCurves);
    appendCurve(g1.id, { datasetId: g2.id, xKey: null, yKey: 0, label: "g2" });
    expect(get(g1.id).linkedCurves).toHaveLength(3);

    const before = get(g2.id);
    useToasts.setState({ toasts: [] });
    expect(() => appendCurve(g2.id, { datasetId: g1.id, xKey: null, yKey: 0, label: "g1" })).not.toThrow();
    expect(get(g2.id)).toBe(before); // untouched
    expect(useToasts.getState().toasts.map((t) => t.msg).join(" ")).toMatch(/depend on each other|cycle|circular/i);

    // The app still works: a source edit reaches both graphs.
    const a = get("a");
    expect(() =>
      useApp.setState((s) => ({
        datasets: s.datasets.map((d) => (d.id === "a" ? { ...a, data: { ...a.data, values: [[9], [8], [7]] } } : d)),
      })),
    ).not.toThrow();
    expect(get(g1.id).data.values.map((r) => r[0]).slice(0, 3)).toEqual([9, 8, 7]);
  });

  it("a graph cannot take a curve from itself", async () => {
    await plotSelectedTogether(["a", "b"]);
    const g = useApp.getState().datasets.find((d) => d.linkedCurves)!;
    appendCurve(g.id, { datasetId: g.id, xKey: null, yKey: 0, label: "self" });
    expect(get(g.id).linkedCurves).toHaveLength(2);
  });
});

describe("a cycle that arrives anyway fails closed", () => {
  it("draws the graphs on the cycle empty, does not throw, and leaves the rest working", () => {
    useApp.setState({
      datasets: [plain("a", [1, 2, 3]), graphOf("g1", [curve("a"), curve("g2")]), graphOf("g2", [curve("g1")]), graphOf("ok", [curve("a")])],
    });
    expect(() => watchLinkedCurves()).not.toThrow();
    for (const id of ["g1", "g2"]) {
      expect(get(id).data.values.every((r) => r.every((v) => Number.isNaN(v)))).toBe(true);
      expect(get(id).linkedCurves).toHaveLength(id === "g1" ? 2 : 1); // curve list is kept, never rebound
    }
    expect(get("ok").data.values.map((r) => r[0])).toEqual([1, 2, 3]);
    // ... and stays quiet: a second pass changes nothing (no ping-pong).
    expect(relinkedDatasets(useApp.getState().datasets)).toBeNull();
  });

  it("a self-referencing graph does not throw", () => {
    useApp.setState({ datasets: [plain("a", [1, 2, 3]), graphOf("s", [curve("a"), curve("s")])] });
    expect(() => watchLinkedCurves()).not.toThrow();
    expect(relinkedDatasets(useApp.getState().datasets)).toBeNull();
  });
});

describe("a graph of a graph rebuilds in topological order", () => {
  it("one pass brings the outer graph in step with the source edit", () => {
    // Deliberately listed outer-first.
    const inner = graphOf("inner", [curve("a")]);
    const outer = graphOf("outer", [curve("inner")]);
    useApp.setState({ datasets: [plain("a", [1, 2, 3]), outer, inner] });
    watchLinkedCurves();
    const a = get("a");
    const next = relinkedDatasets(
      useApp.getState().datasets.map((d) => (d.id === "a" ? { ...a, data: { ...a.data, values: [[7], [8], [9]] } } : d)),
    )!;
    expect(next.find((d) => d.id === "outer")!.data.values.map((r) => r[0])).toEqual([7, 8, 9]);
  });
});

describe("Add curve from… end to end", () => {
  it("offers the cyclic source but refuses it with a message that names the reason", async () => {
    const { addCurveFrom } = await import("../lib/plotSelectedTogether");
    const { askParams } = await import("./paramDialog");
    await plotSelectedTogether(["a", "b"]);
    await plotSelectedTogether(["a", "b"]);
    const [g1, g2] = useApp.getState().datasets.filter((d) => d.linkedCurves);
    appendCurve(g1.id, { datasetId: g2.id, xKey: null, yKey: 0, label: "g2" });
    useApp.setState({ activeId: g2.id });
    vi.mocked(askParams).mockResolvedValueOnce({ dataset: g1.name }).mockResolvedValueOnce({ x: "(its own X)", y: "g2" });
    useToasts.setState({ toasts: [] });
    await addCurveFrom();
    expect(get(g2.id).linkedCurves).toHaveLength(2); // unchanged
    expect(useToasts.getState().toasts.map((t) => t.msg).join(" ")).toMatch(/depend on each other/);
  });
});
