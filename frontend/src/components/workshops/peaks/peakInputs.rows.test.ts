// P4 phase 3: a per-peak fit sends `rows` + the X/Y channel instead of x/y
// when the server holds the dataset (usePeaks -> lib/fitSource). One case per
// selection rule: those rows gather to exactly the x/y peakInputs returns.
import { describe, expect, it } from "vitest";

import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import { rowRuns } from "../../../lib/fitSource";
import type { Dataset, DataStruct } from "../../../lib/types";
import { gatherRows } from "../../../test/gatherRows";
import { peakInputs } from "./peakInputs";

const N = 12;
function data(): DataStruct {
  const time = Array.from({ length: N }, (_, i) => (i === 3 ? -0 : i));
  const values = time.map((_, i) => [
    i === 2 ? (null as unknown as number) : 5 * i + 2,
    (N - i) * 2,
    i === 7 ? Number.NaN : 50 - i,
  ]);
  return { time, values, labels: ["R1", "T2", "R2"], units: ["", "", ""], metadata: {} };
}

function check(ds: Dataset, yKeys: number[] | null, subset?: { rows: number[]; lo: number; hi: number }): void {
  const item = subset
    ? captureAnalysisSelection({
        datasets: [ds], activeId: ds.id, selectedIds: [ds.id], xKey: null, yKeys: yKeys ?? [0], seriesOrder: null,
        errKeys: {}, selection: { datasetId: ds.id, rows: subset.rows }, range: { lo: subset.lo, hi: subset.hi, source: "manual" },
      }, "analysis-center").items[0]
    : undefined;
  const inputs = peakInputs(ds, null, yKeys, null, item);
  const runs = rowRuns(inputs.rows!());
  expect(runs).not.toBeNull();
  const got = gatherRows(ds.data, { x_channel: inputs.xKeyUsed ?? -1, y_channel: inputs.yKeyUsed!, rows: runs! });
  expect(JSON.stringify(got.x)).toBe(JSON.stringify(inputs.x));
  expect(JSON.stringify(got.y)).toBe(JSON.stringify(inputs.y));
  expect(inputs.x.length).toBeGreaterThan(0);
}

describe("peakInputs rows", () => {
  it("the analysis view and its gap drop", () => check({ id: "d", name: "d", data: data() }, [0]));
  it("manual exclusions", () => check({ id: "d", name: "d", data: data(), excludedRows: [0, 5, 6] }, [0]));
  it("an analysis selection", () =>
    check({ id: "d", name: "d", data: data(), excludedRows: [4] }, [0], { rows: [1, 2, 3, 4, 8, 9, 10], lo: 0, hi: 9 }));
  it("per-series X", () => check({ id: "d", name: "d", data: data(), columnDesignations: { 1: "X" } }, [2]));
  it("the fallback channel", () => check({ id: "d", name: "d", data: data(), excludedRows: [9] }, []));
});

describe("rowRuns", () => {
  it("encodes ascending rows and refuses anything else", () => {
    expect(rowRuns([0, 1, 2, 5, 6, 9])).toEqual([[0, 3], [5, 2], [9, 1]]);
    expect(rowRuns([])).toEqual([]);
    expect(rowRuns([3, 3])).toBeNull();
    expect(rowRuns([4, 2])).toBeNull();
    expect(rowRuns([0.5])).toBeNull();
  });
});
