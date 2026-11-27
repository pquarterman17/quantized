// R1 of ROW_RANGE_CONTRACT: the shared resolver applies a row range first, then
// the analysis view, then selected rows, then the X range, and says so.
import { describe, expect, it } from "vitest";

import { analysisInputSummary, analysisRowPolicyNote, resolveAnalysisInputs, ROW_POLICY } from "./analysisInputs";
import type { AnalysisSelectionItem } from "./analysisSelection";
import type { Dataset } from "./types";

const n = 60;
const sheet = (over: Partial<Dataset> = {}): Dataset => ({
  id: "d",
  name: "run.csv",
  data: {
    time: Array.from({ length: n }, (_v, i) => i), // x = row position
    values: Array.from({ length: n }, (_v, i) => [i * 10]),
    labels: ["v"], units: ["V"], metadata: {},
  },
  ...over,
});
const item = (over: Partial<AnalysisSelectionItem> = {}): AnalysisSelectionItem => ({
  datasetId: "d", xKey: null, yKeys: [0], errorBindings: [], errorKeys: {}, factorKeys: [],
  rowIds: null, range: null, roi: null, ...over,
});
const resolve = (dataset: Dataset, selection: AnalysisSelectionItem, policy: typeof ROW_POLICY[keyof typeof ROW_POLICY] = ROW_POLICY.selection, counts?: boolean) =>
  resolveAnalysisInputs({ datasets: [dataset], activeId: "d", selection, policy, counts });

describe("row range in the resolver", () => {
  const range = { from: 20, to: 43 };

  it("prints the window as the denominator and says the range in the rule sentence", () => {
    const inputs = resolve(sheet({ excludedRows: [25, 30, 40, 5] }), item({ rowRange: range }));
    expect(inputs.ok && inputs.rowCount).toBe(21);
    expect(analysisInputSummary(inputs)).toBe("Input: run.csv · X: X · Y: v (V) · rows 21-44 · 21 of 24 rows (3 excluded)");
    expect(analysisRowPolicyNote(inputs)).toMatch(/Limited to rows 21-44\.$/);
  });

  it("applies range, then exclusions, then selected rows, then the X range (the four-way order)", () => {
    const inputs = resolve(
      sheet({ excludedRows: [22, 50] }),
      item({ rowRange: range, rowIds: [10, 21, 22, 23, 24, 25, 60], range: { lo: 22, hi: 24.5, source: "manual" } }),
    );
    if (!inputs.ok) throw new Error(inputs.reason);
    // window 20..43, row 22 excluded, picked {21,23,24,25}, x 22..24.5 -> 23, 24
    expect(inputs.rowIds).toEqual([23, 24]);
    expect(inputs.data.time).toEqual([23, 24]);
    expect(inputs.viewRowIds).toHaveLength(n - 2); // the whole view: the positions fits record
  });

  it("without a range the result and the summary are unchanged", () => {
    const inputs = resolve(sheet(), item());
    expect(inputs.ok && inputs.rowRange).toBeNull();
    expect(analysisInputSummary(inputs)).toBe("Input: run.csv · X: X · Y: v (V) · 60 of 60 rows");
    expect(analysisRowPolicyNote(inputs)).not.toMatch(/Limited to/);
  });

  it("counts filtered-out rows in the window and drops the parenthesis on the lean path", () => {
    const filtered = sheet({ excludedRows: [21], filter: [{ col: 0, kind: "range", max: 250 }] });
    const full = resolve(filtered, item({ rowRange: { from: 20, to: 29 } }));
    if (!full.ok) throw new Error(full.reason);
    expect(analysisInputSummary(full)).toMatch(/rows 21-30 · 5 of 10 rows \(1 excluded, 4 filtered out\)$/);
    const lean = resolve(filtered, item({ rowRange: { from: 20, to: 29 } }), ROW_POLICY.selection, false);
    expect(analysisInputSummary(lean)).toMatch(/rows 21-30 · 5 of 10 rows$/);
  });

  it("refuses a range past the end, an emptied range and a pending book; never all rows", () => {
    const past = resolve(sheet(), item({ rowRange: { from: 50, to: 70 } }));
    expect(!past.ok && past.reason).toBe("rows 51-71 is beyond the worksheet's 60 rows");
    const gone = resolve(sheet(), item({ rowRange: { from: 4, to: 3, was: "rows 5-8" } }));
    expect(!gone.ok && gone.reason).toBe("rows 5-8 no longer exist");
    const pending = resolve(sheet({ pending: { kind: "path", path: "/p.opj", bookId: "B", rows: 60, cols: 1 } }), item({ rowRange: range }));
    expect(!pending.ok && pending.code).toBe("pending");
    const allExcluded = resolve(sheet({ excludedRows: Array.from({ length: 24 }, (_v, i) => 20 + i) }), item({ rowRange: range }));
    expect(!allExcluded.ok && allExcluded.code).toBe("no-rows");
  });

  it("is ignored by a policy that does not narrow (Signal Processing keeps every row)", () => {
    const inputs = resolve(sheet(), item({ rowRange: range }), ROW_POLICY.fullWorksheet);
    expect(inputs.ok && inputs.rowCount).toBe(n);
    expect(inputs.ok && inputs.rowRange).toBeNull();
  });

  it("the statistics policy narrows too, and every policy states the field", () => {
    for (const [name, policy] of Object.entries(ROW_POLICY)) {
      expect(["narrow", "ignore"], name).toContain(policy.rowRange);
    }
    const inputs = resolve(sheet(), item({ rowRange: range }), ROW_POLICY.analysisView);
    expect(inputs.ok && inputs.rowCount).toBe(24);
  });

  it("a policy that does not read the range says it is not applied (Baseline Estimate, Signal Processing, Pie)", () => {
    for (const policy of [ROW_POLICY.fullWorksheet, ROW_POLICY.analysisViewAllRows]) {
      const inputs = resolve(sheet(), item({ rowRange: range }), policy);
      expect(inputs.ok && inputs.rowCount).toBe(n);
      expect(inputs.ok && inputs.rowRange).toBeNull();
      expect(analysisRowPolicyNote(inputs)).toMatch(/The row range \(rows 21-44\) is not applied\.$/);
    }
  });

  it("a range passed with no selection item narrows the same way (the statistics tools)", () => {
    const inputs = resolveAnalysisInputs({ datasets: [sheet()], activeId: "d", yKeys: [0], noX: true, policy: ROW_POLICY.analysisView, rowRange: range });
    expect(inputs.ok && inputs.rowIds).toEqual(Array.from({ length: 24 }, (_v, i) => 20 + i));
  });
});
