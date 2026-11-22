import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { byLevelBatchResult, type ByLevelBatchInput } from "./byLevelBatchResult";
import { EXTRA_DESCRIBERS } from "./resultBookDescribe";
import { columnByName, columnName, statsBatchData } from "./statsBatchColumns";
import type { DataStruct } from "./types";

const input = (over: Partial<ByLevelBatchInput> = {}): ByLevelBatchInput => ({
  id: "r1", createdAt: "2026-11-22T10:00:00.000Z", toolId: "outlier-screening", label: "Outlier screening",
  datasetId: "d1", sourceFingerprint: "fp", byColumn: { index: 0, label: "Group" }, headers: ["Flagged"],
  rows: [{ label: "A", n: 3, values: [1], error: null }, { label: "B", n: 1, values: [], error: "not enough data (n=1)" }],
  omittedLevels: 0, parameters: { method: "grubbs" },
  ...over,
});

describe("byLevelBatchResult", () => {
  it("records one row per level, a failed level as an error row, under analysis-batch", () => {
    const result = byLevelBatchResult(input()) as AnalysisResult;
    expect(result.producer).toEqual({ id: "analysis-batch", label: "Outlier screening", version: 1 });
    expect(result.sources).toEqual([{ datasetId: "d1", role: "input" }]);
    expect(result.tables![0]).toEqual({
      title: "Batch status",
      columns: ["Level", "Status", "Rows", "Flagged", "Warnings"],
      rows: [["A", "Completed", 3, 1, null], ["B", "Failed", 1, null, "not enough data (n=1)"]],
    });
    expect(result.warnings).toEqual(["B: not enough data (n=1)"]);
    expect(result.parameters).toMatchObject({ toolId: "outlier-screening", byColumn: "Group", method: "grubbs" });
    expect(result.sourceFingerprint).toBe("fp");
    expect(result.stale).toBeUndefined();
  });

  it("says when the level cap left levels unrun", () => {
    const result = byLevelBatchResult(input({ omittedLevels: 2 })) as AnalysisResult;
    expect(result.warnings[0]).toBe("2 further levels were not run (level cap).");
  });

  it("fails closed with no levels or a row that does not fit the columns", () => {
    expect(byLevelBatchResult(input({ rows: [] }))).toBe("No levels have run yet.");
    expect(byLevelBatchResult(input({ rows: [{ label: "A", n: 3, values: [1, 2], error: null }] })))
      .toBe("A level's summary does not match the table columns.");
  });

  it("is described by the Result book as a By run, with its level count", () => {
    const described = EXTRA_DESCRIBERS["analysis-batch"]!(byLevelBatchResult(input()) as AnalysisResult);
    expect(described?.method).toBe("Outlier screening by Group");
    expect(described?.settings).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Levels", value: "2" }),
      expect.objectContaining({ label: "Completed", value: "1" }),
    ]));
  });

  it("keeps the Result book closed for a level table without its By column, and vice versa", () => {
    const by = byLevelBatchResult(input()) as AnalysisResult;
    const { byColumn: _dropped, ...withoutBy } = by.parameters!;
    expect(EXTRA_DESCRIBERS["analysis-batch"]!({ ...by, parameters: withoutBy })).toBeNull();
    const worksheetTable = { ...by.tables![0]!, columns: ["Worksheet", ...by.tables![0]!.columns.slice(1)] };
    expect(EXTRA_DESCRIBERS["analysis-batch"]!({ ...by, tables: [worksheetTable] })).toBeNull();
  });
});

const DATA: DataStruct = {
  time: [0, 1], values: [[1, 2, 3], [4, 5, 6]], labels: ["A", "B", "B"], units: ["", "", ""],
  metadata: { x_column_name: "T" },
};

describe("statsBatchColumns", () => {
  it("finds a column by name, the X axis included", () => {
    expect(columnByName(DATA, "A")).toBe(0);
    expect(columnByName(DATA, "T")).toBe(-1);
    expect(columnName(DATA, -1)).toBe("T");
    expect(columnName(DATA, 9)).toBeNull();
  });

  it("fails closed on a missing or a duplicated name", () => {
    expect(() => columnByName(DATA, "Z")).toThrow('No column named "Z" in this worksheet.');
    expect(() => columnByName(DATA, "B")).toThrow(/2 columns are named "B"/);
  });

  it("reads the analysis view and refuses one with no rows", () => {
    expect(statsBatchData({ id: "d", name: "d", data: DATA, excludedRows: [0] }).time).toEqual([1]);
    expect(() => statsBatchData({ id: "d", name: "d", data: DATA, excludedRows: [0, 1] }))
      .toThrow("No rows remain in this worksheet's analysis view.");
  });
});
