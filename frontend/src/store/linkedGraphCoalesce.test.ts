// The watcher no longer rebuilds inside the store write that caused a change:
// it coalesces, and rebuilds once per burst in a microtask (or on
// flushLinkedCurves). An edit returns at once; Undo still restores exactly.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import type { Dataset } from "../lib/types";
import { flushLinkedCurves, rebuildPasses } from "./linkedCurvesSync";
import { useApp } from "./useApp";

vi.mock("./paramDialog", () => ({ askParams: vi.fn() }));

const plain = (id: string, y: number[]): Dataset => ({
  id,
  name: id,
  data: { time: [1, 2, 3], values: y.map((v) => [v]), labels: ["Y"], units: ["V"], metadata: {} },
});
const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves)!;
const col = () => graph().data.values.map((r) => r[0]).slice(0, 3);
const setA = (v: number) =>
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, data: { ...d.data, values: [[v], [v], [v]] } } : d)) }));

beforeEach(async () => {
  useApp.setState({ datasets: [plain("a", [1, 2, 3]), plain("b", [4, 5, 6])], selectedIds: [], history: [], future: [] });
  await plotSelectedTogether(["a", "b"]);
  flushLinkedCurves();
});

describe("coalesced rebuilds", () => {
  it("a burst of 10 source edits causes exactly 1 rebuild", () => {
    const before = rebuildPasses;
    for (let i = 1; i <= 10; i++) setA(i);
    expect(col()).toEqual([1, 2, 3]); // the edit returned; the graph has not been rebuilt yet
    flushLinkedCurves();
    expect(rebuildPasses - before).toBe(1);
    expect(col()).toEqual([10, 10, 10]);
    flushLinkedCurves();
    expect(rebuildPasses - before).toBe(1); // nothing pending
  });

  it("rebuilds on its own in a microtask", async () => {
    setA(7);
    await Promise.resolve();
    expect(col()).toEqual([7, 7, 7]);
  });

  it("Undo restores the source and the graph exactly", () => {
    useApp.getState().recordHistory("edit a");
    setA(99);
    flushLinkedCurves();
    expect(col()).toEqual([99, 99, 99]);
    useApp.getState().undo();
    flushLinkedCurves();
    expect(col()).toEqual([1, 2, 3]);
    expect(useApp.getState().datasets.find((d) => d.id === "a")!.data.values[0][0]).toBe(1);
  });
});
