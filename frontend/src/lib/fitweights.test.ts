import { describe, expect, it } from "vitest";

import type { Dataset } from "./types";
import { dyForFit } from "./fitweights";

// field, moment, err(good), bad(has non-positive). Row 1 excluded, so every
// resolved dy is aligned to the analysis rows [0, 2, 3] — same pruning the fit
// consumes (selectedFitData).
const dataset: Dataset = {
  id: "d",
  name: "m.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [
      [100, 10, 2, 0],
      [200, 20, 9, 9],
      [300, 30, 3, -1],
      [400, 40, 4, 5],
    ],
    labels: ["field", "moment", "err", "bad"],
    units: ["Oe", "emu", "emu", ""],
    metadata: {},
  },
  excludedRows: [1],
};

describe("dyForFit", () => {
  it("returns null (unweighted) for mode none", () => {
    expect(dyForFit(dataset, 1, { mode: "none" })).toEqual({ dy: null });
  });

  it("poisson uses sqrt(max(|y|,1)) over the analysis rows", () => {
    const { dy } = dyForFit(dataset, 1, { mode: "poisson" });
    expect(dy).toEqual([Math.sqrt(10), Math.sqrt(30), Math.sqrt(40)]);
  });

  it("poisson floors sigma at 1 so a zero count stays > 0", () => {
    // yKey 3 (bad) has values [0, (excl), -1, 5] -> analysis [0, -1, 5]
    const { dy } = dyForFit(dataset, 3, { mode: "poisson" });
    expect(dy).toEqual([1, 1, Math.sqrt(5)]); // sqrt(max(0,1))=1, sqrt(max(1,1))=1
  });

  it("yerr reads the abs of the designated error column, row-aligned", () => {
    const { dy, issue } = dyForFit(dataset, 1, { mode: "yerr", errKey: 2 });
    expect(dy).toEqual([2, 3, 4]);
    expect(issue).toBeUndefined();
  });

  it("yerr with no designated column reports an issue and stays unweighted", () => {
    const r = dyForFit(dataset, 1, { mode: "yerr" });
    expect(r.dy).toBeNull();
    expect(r.issue).toMatch(/no error column/);
  });

  it("manual uses the picked column; rejects a non-positive column", () => {
    expect(dyForFit(dataset, 1, { mode: "manual", errKey: 2 }).dy).toEqual([2, 3, 4]);
    const bad = dyForFit(dataset, 1, { mode: "manual", errKey: 3 }); // [0, -1, 5]
    expect(bad.dy).toBeNull();
    expect(bad.issue).toMatch(/non-positive|invalid/);
  });

  it("rejects an out-of-range error column", () => {
    expect(dyForFit(dataset, 1, { mode: "manual", errKey: 9 }).dy).toBeNull();
  });
});
