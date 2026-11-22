import { describe, expect, it } from "vitest";

import {
  analysisInputSummary,
  analysisRowPolicyNote,
  analysisTargetDataset,
  resolveAnalysisInputs,
  ROW_POLICY,
  type AnalysisInputsResolved,
} from "./analysisInputs";
import type { AnalysisSelectionItem } from "./analysisSelection";
import type { Dataset } from "./types";

const sheet = (id: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name: `${id}.csv`,
  data: {
    time: [0, 1, 2, 3, 4, 5],
    values: [[10, 1], [20, 2], [30, 3], [40, 4], [50, 5], [60, 6]],
    labels: ["v", "w"],
    units: ["V", ""],
    metadata: { x_column_name: "T", x_column_unit: "s" },
  },
  ...over,
});

const item = (datasetId: string, over: Partial<AnalysisSelectionItem> = {}): AnalysisSelectionItem => ({
  datasetId, xKey: null, yKeys: [0], errorBindings: [], errorKeys: {}, factorKeys: [],
  rowIds: null, range: null, roi: null, ...over,
});

const ok = (value: ReturnType<typeof resolveAnalysisInputs>): AnalysisInputsResolved => {
  if (!value.ok) throw new Error(`refused: ${value.reason}`);
  return value;
};

describe("resolveAnalysisInputs — precedence", () => {
  const a = sheet("a");
  const b = sheet("b");

  it("uses the active worksheet when the tool has no selection item", () => {
    const inputs = ok(resolveAnalysisInputs({ datasets: [a, b], activeId: "b", yKeys: [1], policy: ROW_POLICY.analysisView }));
    expect(inputs.dataset.id).toBe("b");
    expect(inputs.datasetSource).toBe("active");
    expect(inputs.columnSource).toBe("tool");
  });

  it("a selection item outranks the active worksheet", () => {
    const inputs = ok(resolveAnalysisInputs({ datasets: [a, b], activeId: "b", selection: item("a"), policy: ROW_POLICY.selection }));
    expect(inputs.dataset.id).toBe("a");
    expect(inputs.datasetSource).toBe("selection");
    expect(inputs.columnSource).toBe("selection");
    expect(inputs.yKeys).toEqual([0]);
  });

  it("an explicit tool pick outranks the selection's roles", () => {
    const inputs = ok(resolveAnalysisInputs({ datasets: [a], activeId: "a", selection: item("a", { yKeys: [0] }), yKeys: [1], policy: ROW_POLICY.selection }));
    expect(inputs.yKeys).toEqual([1]);
    expect(inputs.columnSource).toBe("tool");
  });
});

describe("resolveAnalysisInputs — stale and deleted ids fail closed", () => {
  it("refuses a handoff whose worksheet was deleted instead of using the active one", () => {
    const result = resolveAnalysisInputs({ datasets: [sheet("b")], activeId: "b", selection: item("gone"), policy: ROW_POLICY.selection });
    expect(result).toMatchObject({ ok: false, code: "missing-dataset" });
    expect(analysisTargetDataset([sheet("b")], "b", item("gone"))).toBeNull();
  });

  it("only the live plot capture follows the active worksheet, without borrowing the stale item's roles", () => {
    const result = resolveAnalysisInputs({
      datasets: [sheet("b")], activeId: "b", selection: item("gone", { yKeys: [1], rowIds: [0] }),
      followActive: true, policy: ROW_POLICY.selection,
    });
    expect(result).toMatchObject({ ok: false, code: "no-response", dataset: { id: "b" }, datasetSource: "active" });
    expect(analysisTargetDataset([sheet("b")], "b", item("gone"), true)?.id).toBe("b");
  });

  it("refuses when no worksheet is active", () => {
    expect(resolveAnalysisInputs({ datasets: [], activeId: null, yKeys: [0], policy: ROW_POLICY.analysisView }))
      .toMatchObject({ ok: false, code: "no-dataset" });
  });

  it("refuses a deleted X or response column", () => {
    const a = sheet("a");
    expect(resolveAnalysisInputs({ datasets: [a], activeId: "a", selection: item("a", { xKey: 7 }), policy: ROW_POLICY.selection }))
      .toMatchObject({ ok: false, code: "missing-column" });
    expect(resolveAnalysisInputs({ datasets: [a], activeId: "a", yKeys: [0, 9], policy: ROW_POLICY.analysisView }))
      .toMatchObject({ ok: false, code: "missing-column" });
  });

  it("accepts the X/time column (-1) as an analysed column", () => {
    const inputs = ok(resolveAnalysisInputs({ datasets: [sheet("a")], activeId: "a", yKeys: [-1], policy: ROW_POLICY.analysisView }));
    expect(analysisInputSummary(inputs)).toContain("Y: T (s)");
  });
});

describe("resolveAnalysisInputs — lazy Origin data and empty selections", () => {
  it("refuses a lazy Origin preview instead of analysing its downsampled rows", () => {
    const lazy = sheet("a", { pending: { kind: "upload", bookId: "b1", rows: 600, cols: 2, previewSampled: true } });
    const result = resolveAnalysisInputs({ datasets: [lazy], activeId: "a", yKeys: [0], policy: ROW_POLICY.analysisView });
    expect(result).toMatchObject({ ok: false, code: "pending" });
    expect(analysisInputSummary(result)).toMatch(/^Input: a\.csv · The full worksheet is still loading/);
  });

  it("refuses an empty response list", () => {
    expect(resolveAnalysisInputs({ datasets: [sheet("a")], activeId: "a", yKeys: [], policy: ROW_POLICY.analysisView }))
      .toMatchObject({ ok: false, code: "no-response" });
  });

  it("refuses an explicitly empty row selection rather than widening it to every row", () => {
    expect(resolveAnalysisInputs({ datasets: [sheet("a")], activeId: "a", selection: item("a", { rowIds: [] }), policy: ROW_POLICY.selection }))
      .toMatchObject({ ok: false, code: "no-rows" });
  });

  it("refuses when exclusions and filters leave nothing", () => {
    const allOut = sheet("a", { excludedRows: [0, 1, 2, 3, 4, 5] });
    expect(resolveAnalysisInputs({ datasets: [allOut], activeId: "a", yKeys: [0], policy: ROW_POLICY.analysisView }))
      .toMatchObject({ ok: false, code: "no-rows" });
  });

  it("refuses a range that keeps no rows", () => {
    const selection = item("a", { range: { lo: 100, hi: 200, source: "manual" } });
    expect(resolveAnalysisInputs({ datasets: [sheet("a")], activeId: "a", selection, policy: ROW_POLICY.selection }))
      .toMatchObject({ ok: false, code: "no-rows" });
  });
});

describe("resolveAnalysisInputs — row policy", () => {
  // Row 1 excluded, row 5 filtered out (time > 4.5).
  const a = sheet("a", { excludedRows: [1], filter: [{ col: -1, kind: "range", max: 4.5 }] });
  const selection = item("a", { rowIds: [0, 1, 2, 3], range: { lo: 1.5, hi: 10, source: "manual" } });

  it("analysis view: exclusions and filters dropped, selected rows and range ignored", () => {
    const inputs = ok(resolveAnalysisInputs({ datasets: [a], activeId: "a", selection, policy: ROW_POLICY.analysisView }));
    expect(inputs.rowIds).toEqual([0, 2, 3, 4]);
    expect(inputs.data.values.map((row) => row[0])).toEqual([10, 30, 40, 50]);
    expect([inputs.excludedCount, inputs.filteredCount, inputs.totalRows]).toEqual([1, 1, 6]);
    expect(analysisRowPolicyNote(inputs)).toBe(
      "Excluded and filtered-out rows are left out (1 excluded row, 1 filtered-out row). Selected rows are not used. The plot X range is not applied.",
    );
  });

  it("selection: the analysis view, then the selected rows and the X range", () => {
    const inputs = ok(resolveAnalysisInputs({ datasets: [a], activeId: "a", selection, policy: ROW_POLICY.selection }));
    expect(inputs.rowIds).toEqual([2, 3]);
    expect(inputs.data.time).toEqual([2, 3]);
    expect(analysisInputSummary(inputs)).toBe("Input: a.csv · X: T (s) · Y: v (V) · 2 of 6 rows · X 1.5–10");
    expect(analysisRowPolicyNote(inputs)).toMatch(/Only the selected rows are used\. Limited to the X range\.$/);
  });

  it("full worksheet: every row, and the note says how many would otherwise drop", () => {
    const inputs = ok(resolveAnalysisInputs({ datasets: [a], activeId: "a", xKey: null, yKeys: [0, 1], policy: ROW_POLICY.fullWorksheet }));
    expect(inputs.data).toBe(a.data);
    expect(inputs.rowIds).toEqual([0, 1, 2, 3, 4, 5]);
    expect(analysisInputSummary(inputs)).toBe("Input: a.csv · X: T (s) · Y: v (V), w · 6 of 6 rows");
    expect(analysisRowPolicyNote(inputs)).toBe(
      "Uses every row, including 2 excluded or filtered-out rows. Selected rows are not used. The plot X range is not applied.",
    );
  });

  it("a refusal still states the worksheet's row state", () => {
    const result = resolveAnalysisInputs({ datasets: [a], activeId: "a", yKeys: [], policy: ROW_POLICY.fullWorksheet });
    expect(result.ok).toBe(false);
    expect(analysisRowPolicyNote(result)).toMatch(/^Uses every row, including 2 excluded or filtered-out rows\./);
  });

  it("returns the dataset's own data when nothing is dropped", () => {
    const clean = sheet("c");
    const inputs = ok(resolveAnalysisInputs({ datasets: [clean], activeId: "c", yKeys: [0], policy: ROW_POLICY.analysisView }));
    expect(inputs.data).toBe(clean.data);
    expect(analysisRowPolicyNote(inputs)).toMatch(/^Excluded and filtered-out rows are left out \(none at present\)\./);
  });
});
