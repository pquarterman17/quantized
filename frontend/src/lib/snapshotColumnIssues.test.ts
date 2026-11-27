import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { snapshotColumnIssues } from "./snapshotColumnIssues";
import type { Dataset } from "./types";

const result = (channels: { index: number; label: string; unit: string }[]): AnalysisResult => ({
  version: 1, id: "r", name: "R", producer: { id: "distribution-analysis", label: "Distribution", version: 1 },
  sources: [{ datasetId: "s", role: "input" }], outputs: [], warnings: [], createdAt: "2026-01-01",
  selection: { datasetId: "s", channels },
});
const sheet = (labels: string[], values: number[][], extra: Partial<Dataset["data"]> = {}): Dataset => ({
  id: "s", name: "Lots",
  data: { time: values.map((_, i) => i), values, labels, units: labels.map(() => ""), metadata: {}, ...extra },
});
const saved = [{ index: 0, label: "T", unit: "K" }, { index: 1, label: "R", unit: "" }];

describe("snapshotColumnIssues", () => {
  it("is empty when every saved column still matches", () => {
    expect(snapshotColumnIssues(result(saved), sheet(["T", "R"], [[1, 2]]))).toEqual([]);
  });
  it("names a vanished column, a renamed one and a moved one", () => {
    expect(snapshotColumnIssues(result(saved), sheet(["T"], [[1]]))).toEqual(["“R” is no longer in “Lots”"]);
    expect(snapshotColumnIssues(result(saved), sheet(["X", "R"], [[1, 2]]))).toEqual(["column 1 (saved as “T”) is now “X”"]);
    expect(snapshotColumnIssues(result(saved), sheet(["R", "T"], [[1, 2]]))).toEqual([
      "“T” moved from column 1 to column 2", "“R” moved from column 2 to column 1",
    ]);
  });
  it("names a column with no numeric value, and a united column that turned categorical", () => {
    expect(snapshotColumnIssues(result(saved), sheet(["T", "R"], [[Number.NaN, 2]]))).toEqual(["“T” has no numeric values now"]);
    const cat = sheet(["T", "R"], [[0, 1], [1, 2]], { cat_levels: { 0: ["a", "b"], 1: ["x", "y", "z"] } });
    // R carried no unit, so it may always have been a grouping column: not reported.
    expect(snapshotColumnIssues(result(saved), cat)).toEqual(["“T” is now a text (categorical) column"]);
  });
  it("is empty without a source or without recorded channels", () => {
    expect(snapshotColumnIssues(result(saved), undefined)).toEqual([]);
    expect(snapshotColumnIssues({ ...result(saved), selection: undefined }, sheet(["Q"], [[1]]))).toEqual([]);
  });
});
