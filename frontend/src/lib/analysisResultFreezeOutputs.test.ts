import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { FREEZE_ADAPTERS, enumerateFreezeOutputs, frozenOutputName } from "./analysisResultFreezeOutputs";
import type { Dataset } from "./types";

const ds = (id: string, rows: number, derived: boolean): Dataset => ({
  id, name: `Sheet ${id}`,
  data: { time: Array.from({ length: rows }, (_, i) => i), values: Array.from({ length: rows }, () => [1, 2]), labels: ["A", "B"], units: ["", ""], metadata: {} },
  ...(derived ? { derivedFrom: { datasetId: "src", pipeline: "P" } } : {}),
});
const result = (producer: string, extra: Partial<AnalysisResult> = {}): AnalysisResult => ({
  version: 1, id: "r", name: "Result", producer: { id: producer, label: producer, version: 1 },
  sources: [{ datasetId: "src", role: "input" }], outputs: [], warnings: [], createdAt: "2026-01-01", ...extra,
});
const datasets = [ds("o1", 5, true), ds("o2", 3, true), ds("o3", 2, false)];
const tables = [
  { title: "Params", columns: ["a", "b"], rows: [[1, 2], [3, null]] },
  { title: "Labels", columns: ["name", "v"], rows: [["x", 1]] },
  { columns: ["e"], rows: [] },
];

describe("freeze output adapters", () => {
  it("signal-processing lists its linked worksheets only, with size", () => {
    const out = enumerateFreezeOutputs(result("signal-processing", {
      outputs: [{ datasetId: "o1", role: "linked-worksheet" }, { datasetId: "o2", role: "linked-worksheet" }],
      tables: tables.slice(0, 1),
    }), datasets);
    expect(out.map((o) => [o.key, o.kind, o.rows, o.cols, o.freezable])).toEqual([
      ["ds:o1", "Linked worksheet", 5, 2, true], ["ds:o2", "Linked worksheet", 3, 2, true],
    ]);
  });
  it("linked adapter dedupes outputs/tableRefs, skips unresolved, flags independent sheets", () => {
    const out = enumerateFreezeOutputs(result("signal-processing", {
      outputs: [{ datasetId: "o1", role: "linked-worksheet" }, { datasetId: "gone", role: "linked-worksheet" }],
      tableRefs: [{ datasetId: "o1", label: "Dup" }, { datasetId: "o3", label: "Plain" }],
    }), datasets);
    expect(out.map((o) => [o.key, o.label, o.freezable, o.reason])).toEqual([
      ["ds:o1", "Sheet o1", true, undefined], ["ds:o3", "Plain", false, "already independent"],
    ]);
  });
  it.each(["statistical-test", "distribution-analysis", "fit-y-by-x", "variability-analysis", "outlier-screening",
    "multivariate-analysis", "williamson-hall", "williamson-hall-batch", "analysis-batch"])("%s lists linked worksheets then saved tables", (producer) => {
    const out = enumerateFreezeOutputs(result(producer, { tableRefs: [{ datasetId: "o2", label: "Fitted" }], tables }), datasets);
    expect(out.map((o) => [o.key, o.label, o.kind, o.rows, o.cols, o.freezable, o.reason])).toEqual([
      ["ds:o2", "Fitted", "Linked worksheet", 3, 2, true, undefined],
      ["tbl:0", "Params", "Result table", 2, 2, true, undefined],
      ["tbl:1", "Labels", "Result table", 1, 2, false, "contains text cells"],
      ["tbl:2", "Table 3", "Result table", 0, 1, false, "empty table"],
    ]);
  });
  it.each(["peak-analysis", "curve-fit", "reflectivity-fit"])("%s owns no result-level output (data lives on the source)", (producer) => {
    expect(enumerateFreezeOutputs(result(producer, { tables }), datasets)).toEqual([]);
  });
  it("an unknown producer falls back to linked worksheets, never inline tables", () => {
    expect("future-tool" in FREEZE_ADAPTERS).toBe(false);
    const out = enumerateFreezeOutputs(result("future-tool", { outputs: [{ datasetId: "o1", role: "linked-worksheet" }], tables }), datasets);
    expect(out.map((o) => o.key)).toEqual(["ds:o1"]);
  });
  it("names frozen worksheets <result> — <output> (frozen)", () => {
    const [o] = enumerateFreezeOutputs(result("statistical-test", { tables }), datasets);
    expect(frozenOutputName(result("x"), o)).toBe("Result — Params (frozen)");
  });
});
