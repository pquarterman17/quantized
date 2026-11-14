// Review finding 6: the stacked-panel error spans were built from the SOURCE
// rows while the panel's series come from the per-series-X view (one block of
// rows per X), so a secondary-X curve's spans covered only the first block.

import { describe, expect, it } from "vitest";

import { stackErrorSpans } from "./perSeriesX";
import type { Dataset } from "./types";

const ds: Dataset = {
  id: "m",
  name: "m",
  data: {
    time: [1, 2, 3],
    values: [[10, 5, 100, 1], [20, 3, 200, 2], [30, 9, 300, 3]],
    labels: ["R1", "T2", "R2", "dR2"],
    units: ["", "", "", ""],
    metadata: {},
  },
  columnDesignations: { 1: "X" },
  errorRoles: [{ channel: 3, target: 2, axis: "y", side: "both" }],
};

describe("stackErrorSpans", () => {
  it("spans for a secondary-X curve are as long as the view and carry values in ITS block", () => {
    const [spans] = stackErrorSpans(ds, null, [2]);
    const plus = spans.get(1)![0].plus as number[];
    expect(plus).toHaveLength(6); // two blocks of 3 rows
    expect(plus.slice(3)).toEqual([1, 2, 3]);
  });
  it("without a per-series X the spans are over the source rows", () => {
    const one: Dataset = { ...ds, columnDesignations: undefined };
    const [spans] = stackErrorSpans(one, null, [2]);
    expect(spans.get(1)![0].plus).toHaveLength(3);
  });
});
