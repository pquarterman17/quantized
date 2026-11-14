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

  it("round-trips a .dwk on the same point", () => {
    useApp.getState().loadWorkspace(parseWorkspace(serializeWorkspace(useApp.getState())));
    flushLinkedCurves();
    expect(maskedOnSource()).toEqual([50]);
    expect(maskedOnGraph()).toEqual([50]);
  });
});
