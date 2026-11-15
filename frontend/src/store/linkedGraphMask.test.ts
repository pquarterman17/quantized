// Gap audit 3 N2 review: a point masked on a LIVE graph is masked at its
// SOURCE point, never at a graph row index -- so inserting, deleting or
// sorting the source's rows keeps the same point masked, deleting the masked
// row takes the mask with it (never onto a neighbour), and Undo restores both
// the source and the mask exactly.

import { beforeEach, describe, expect, it } from "vitest";

import { plotSelectedTogether } from "../lib/plotSelectedTogether";
import { excludedSet } from "../lib/rowstate";
import type { Dataset } from "../lib/types";
import { parseWorkspace } from "../lib/workspace";
import { serializeWorkspace } from "../lib/workspaceSerialize";
import { flushLinkedCurves } from "./linkedCurvesSync";
import { sortWorksheetRows } from "./sortRows";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const sheet = (id: string, n: number): Dataset => ({
  id,
  name: `S${id}`,
  data: {
    time: Array.from({ length: n }, (_, r) => r),
    values: Array.from({ length: n }, (_, r) => [10 * r + (id === "t" ? 1000 : 0)]),
    labels: ["Y"],
    units: ["V"],
    metadata: {},
  },
});

const get = (id: string) => useApp.getState().datasets.find((d) => d.id === id)!;
const graph = () => useApp.getState().datasets.find((d) => d.linkedCurves)!;
/** The Y values of the graph's masked points (both curves). */
const maskedOnGraph = () =>
  [...excludedSet(graph())].sort((a, b) => a - b).map((r) => graph().data.values[r].find((v) => !Number.isNaN(v)));
const maskedOnSource = () => [...excludedSet(get("s"))].map((r) => get("s").data.values[r][0]);
/** Everything Undo must bring back exactly. */
const state = () => ({ s: get("s").data, sMask: [...excludedSet(get("s"))], gMask: [...excludedSet(graph())], g: graph().data.values });

beforeEach(async () => {
  useApp.setState({ datasets: [sheet("s", 8), sheet("t", 3)], selectedIds: [], history: [], future: [] });
  await plotSelectedTogether(["s", "t"]);
  // Mask the source's row 5 (Y = 50) from the GRAPH: graph row 5.
  useApp.getState().setRowsExcluded(graph().id, [5]);
  flushLinkedCurves();
});

/** Run `op`, check the mask, then Undo restores the source and the mask exactly. */
function step(op: () => void, expectMasked: number[]) {
  flushLinkedCurves();
  const before = state();
  op();
  flushLinkedCurves();
  expect(maskedOnSource()).toEqual(expectMasked);
  expect(maskedOnGraph()).toEqual(expectMasked);
  useApp.getState().undo();
  flushLinkedCurves();
  expect(state()).toEqual(before);
}

describe("a mask set on a live graph lives on the source point", () => {
  it("is written to the source row the graph point draws", () => {
    expect(maskedOnSource()).toEqual([50]);
    expect(maskedOnGraph()).toEqual([50]);
  });

  it("Undo of the mask itself unmasks both the source point and the graph", () => {
    useApp.getState().undo();
    flushLinkedCurves();
    expect(maskedOnSource()).toEqual([]);
    expect(maskedOnGraph()).toEqual([]);
  });

  it("1. survives two rows inserted above it in the source (and Undo)", () => {
    step(() => useApp.getState().insertRows("s", 2, 2), [50]);
  });

  it("2. survives a row deleted above it (and Undo)", () => {
    step(() => useApp.getState().deleteRows("s", [1]), [50]);
  });

  it("3. goes away with the masked row itself, never onto a neighbour (and Undo)", () => {
    step(() => useApp.getState().deleteRows("s", [5]), []);
  });

  it("4. follows its point through a sort (and Undo)", () => {
    step(() => sortWorksheetRows("s", 0, -1), [50]);
    sortWorksheetRows("s", 0, -1);
    flushLinkedCurves();
    expect(get("s").data.values.map((r) => r[0])).toEqual([70, 60, 50, 40, 30, 20, 10, 0]);
    expect(maskedOnGraph()).toEqual([50]);
  });

  it("unmasking the point on the graph unmasks the source point", () => {
    useApp.getState().clearRowExclusions(graph().id);
    flushLinkedCurves();
    expect(maskedOnSource()).toEqual([]);
    expect(maskedOnGraph()).toEqual([]);
  });

  it("a .dwk saved by the earlier build (mask on GRAPH rows) is written through to the sources on load", () => {
    useApp.getState().clearRowExclusions(graph().id);
    flushLinkedCurves();
    const doc = JSON.parse(serializeWorkspace(useApp.getState())) as { datasets: { linkedCurves?: unknown; excludedRows?: number[] }[] };
    doc.datasets.find((d) => d.linkedCurves)!.excludedRows = [5, 9]; // s row 5 (Y=50), t row 1 (Y=1010)
    useApp.getState().loadWorkspace(parseWorkspace(JSON.stringify(doc)));
    flushLinkedCurves();
    expect(maskedOnSource()).toEqual([50]);
    expect(maskedOnGraph()).toEqual([50, 1010]);
  });

  it("an earlier-build graph mask that no longer matches its source is kept on the graph, with a notice", () => {
    useApp.getState().clearRowExclusions(graph().id);
    flushLinkedCurves();
    type Doc = { datasets: { id: string; linkedCurves?: unknown; excludedRows?: number[]; data: { time: number[]; values: number[][] } }[] };
    const doc = JSON.parse(serializeWorkspace(useApp.getState())) as Doc;
    doc.datasets.find((d) => d.linkedCurves)!.excludedRows = [5];
    const s = doc.datasets.find((d) => d.id === "s")!; // the source gained a row since: layout moved
    s.data.time = [...s.data.time, 8];
    s.data.values = [...s.data.values, [80]];
    useApp.getState().loadWorkspace(parseWorkspace(JSON.stringify(doc)));
    flushLinkedCurves();
    expect(maskedOnSource()).toEqual([]);
    expect([...excludedSet(graph())]).toEqual([5]); // never dropped
    expect(useToasts.getState().toasts.map((t) => t.msg).join(" ")).toMatch(/could not be matched/);
  });

  it("a graph mask set in the same burst as a source row change is refused, never mis-mapped", () => {
    useApp.setState((st) => ({ datasets: st.datasets.map((d) => (d.linkedCurves ? { ...d, excludedRows: [5, 6] } : d)) }));
    useApp.setState((st) => ({ datasets: st.datasets.map((d) => (d.id === "s" ? { ...d, data: { ...d.data, values: d.data.values.map((r) => [r[0] + 1]) } } : d)) }));
    flushLinkedCurves();
    expect(maskedOnSource()).toEqual([51]); // only the earlier mask (row 5, now 51)
    expect(useToasts.getState().toasts.map((t) => t.msg).join(" ")).toMatch(/source rows changed at the same time/);
  });

  it("a graph mask never writes into a still-loading (preview) source", () => {
    useApp.setState((st) => ({ datasets: st.datasets.map((d) => (d.id === "t" ? { ...d, pending: {} as never } : d)) }));
    flushLinkedCurves();
    useApp.getState().setRowsExcluded(graph().id, [5, 9]); // row 9 = t's row 1
    flushLinkedCurves();
    expect([...excludedSet(get("t"))]).toEqual([]);
    expect(useToasts.getState().toasts.map((t) => t.msg).join(" ")).toMatch(/still loading/);
  });

  it("round-trips a .dwk on the same point", () => {
    useApp.getState().loadWorkspace(parseWorkspace(serializeWorkspace(useApp.getState())));
    flushLinkedCurves();
    expect(maskedOnSource()).toEqual([50]);
    expect(maskedOnGraph()).toEqual([50]);
  });
});
