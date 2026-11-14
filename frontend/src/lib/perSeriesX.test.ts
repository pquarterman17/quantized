// Origin-gap audit 2 #2: a T1,R1,T2,R2 sheet -- each Y stays on its own
// (nearest-preceding) X whatever the plot's X is. Non-monotonic X on purpose:
// the blocks must keep acquisition order, never a sorted union.

import { describe, expect, it } from "vitest";

import { perSeriesXData, perSeriesXPlan, viewRows } from "./perSeriesX";
import type { Dataset } from "./types";

// .time = T1 (non-monotonic), values = [R1, T2, R2]; T2 designated X ("Set As X").
const sheet = (extra: Partial<Dataset> = {}): Dataset => ({
  id: "s",
  name: "sheet",
  data: {
    time: [300, 100, 200],
    values: [
      [3, 30, 33],
      [1, 10, 11],
      [2, 20, 22],
    ],
    labels: ["R1", "T2", "R2"],
    units: ["ohm", "K", "ohm"],
    metadata: { x_column_name: "T1", x_column_unit: "K" },
  },
  columnDesignations: { 1: "X" },
  ...extra,
});

/** Every finite (x, y) the view pairs for channel `c`. */
function pairs(ds: Dataset, c: number): [number, number][] {
  return ds.data.values.flatMap((row, i) => (Number.isFinite(row[c]) ? [[ds.data.time[i], row[c]] as [number, number]] : []));
}

describe("perSeriesXPlan", () => {
  it("setting T2 as the plot X never re-points R1 onto it (the gap #2 bug)", () => {
    const plan = perSeriesXPlan(sheet(), 1, [0, 2]);
    expect(plan.xKey).toBeNull();
    const view = plan.view!;
    expect(view.blocks).toEqual([null, 1]);
    // R1 pairs with T1, R2 with T2 -- in acquisition order, never sorted.
    expect(pairs(view.dataset, 0)).toEqual([[300, 3], [100, 1], [200, 2]]);
    expect(pairs(view.dataset, 2)).toEqual([[30, 33], [10, 11], [20, 22]]);
    expect(view.dataset.data.time).toEqual([300, 100, 200, 30, 10, 20]);
    expect(view.dataset.data.metadata.x_column_long).toBe("T1 / T2");
    expect(view.dataset.data.metadata.x_column_unit).toBe("K");
  });

  it("R1 alone with T2 as the plot X draws against T1 (no view, X re-pointed)", () => {
    expect(perSeriesXPlan(sheet(), 1, [0])).toEqual({ xKey: null, view: null });
    expect(perSeriesXPlan(sheet(), 1, [2])).toEqual({ xKey: 1, view: null });
  });

  it("a sheet with no designated X is untouched", () => {
    const ds = sheet({ columnDesignations: undefined });
    expect(perSeriesXPlan(ds, 1, [0, 2])).toEqual({ xKey: 1, view: null });
  });

  it("excluded/filtered rows stay excluded in every block", () => {
    const view = perSeriesXPlan(sheet({ excludedRows: [1] }), null, [0, 2]).view!;
    expect(view.dataset.excludedRows).toEqual([1, 4]);
    expect(view.dataset.filter).toBeUndefined();
    expect(viewRows(view, [0, 2])).toEqual([0, 2, 3, 5]);
  });

  it("an error column draws in its target's block", () => {
    const ds = sheet({
      data: { ...sheet().data, values: sheet().data.values.map((r) => [...r, 0.5]), labels: [...sheet().data.labels, "dR1"], units: [...sheet().data.units, "ohm"] },
      // dR1 sits after T2 but belongs to R1.
      errorRoles: [{ channel: 3, target: 0, axis: "y", side: "both" }],
    });
    const view = perSeriesXPlan(ds, null, [0, 2]).view!;
    expect(pairs(view.dataset, 3).map(([x]) => x)).toEqual([300, 100, 200]);
  });

  it("the cache key includes the plot X (review finding 13)", () => {
    // values = [A, R1, T2(X), R2]: R1's base X is the plot X -- A, or .time.
    const ds: Dataset = {
      id: "c",
      name: "c",
      data: {
        time: [0, 1],
        values: [[5, 1, 10, 2], [6, 3, 20, 4]],
        labels: ["A", "R1", "T2", "R2"],
        units: ["", "", "", ""],
        metadata: {},
      },
      columnDesignations: { 2: "X" },
    };
    // Same data, same blocks: only the plot X decides which block R1 joins.
    const onA = perSeriesXData(ds, 0, [null, 0]);
    const onTime = perSeriesXData(ds, null, [null, 0]);
    expect(pairs(onA.dataset, 1)).toEqual([[5, 1], [6, 3]]);
    expect(pairs(onTime.dataset, 1)).toEqual([[0, 1], [1, 3]]);
  });
});
