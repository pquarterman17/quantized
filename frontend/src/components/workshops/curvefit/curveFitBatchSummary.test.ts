// Curve Fit batch summary (audit #10): one column per parameter and its SE
// plus N / R² / reduced χ² / RMSE, and a worksheet (one row per input, text
// columns for worksheet, status and warnings) that can be plotted.

import { describe, expect, it } from "vitest";

import { summaryX } from "../../../lib/batchSummaryX";
import type { AnalysisBatchRow } from "../analysisselection/AnalysisBatchControls";
import { batchColumns, batchSummaryData, fitSummaryValues } from "./curveFitBatchSummary";

describe("Curve Fit batch summary", () => {
  it("has a value and SE column per parameter after the statistics", () => {
    expect(batchColumns(["A", "τ"])).toEqual(["Levels", "Completed", "N", "R²", "Reduced χ²", "RMSE", "A", "A SE", "τ", "τ SE"]);
  });

  it("reads N, R², reduced χ², RMSE and value/SE pairs from a fit (null when absent)", () => {
    expect(fitSummaryValues({ params: [3, 2], errors: [0.1, null], R2: 0.99, chiSqRed: 1.2, RMSE: 0.05, nPoints: 40 }, 2))
      .toEqual([40, 0.99, 1.2, 0.05, 3, 0.1, 2, null]);
  });

  it("builds a plottable worksheet: x = input number, NaN for failed rows, text columns", () => {
    const columns = batchColumns(["τ"]);
    const rows: AnalysisBatchRow[] = [
      { datasetId: "a", name: "s1.csv", rows: 10, status: "completed", values: [1, 1, 10, 0.9, 1.1, 0.1, 2.0, 0.05], warning: null },
      { datasetId: "b", name: "s2.csv", rows: 10, status: "failed", values: [], warning: "no data" },
    ];
    const d = batchSummaryData(rows, columns, "Exponential Decay");
    expect(d.time).toEqual([1, 2]);
    expect(d.labels).toEqual(columns);
    expect(d.values[0]![6]).toBe(2.0);
    expect(d.values[1]!.every(Number.isNaN)).toBe(true);
    expect(d.metadata!.text_columns).toEqual({ Worksheet: ["s1.csv", "s2.csv"], Status: ["Completed", "Failed"], Warnings: ["", "no data"] });
    expect(d.metadata!.curveFitBatch).toMatchObject({ model: "Exponential Decay", sources: [{ id: "a", name: "s1.csv" }, { id: "b", name: "s2.csv" }] });
  });

  it("puts a parameter on X, sorted only on request, with the blank row reported", () => {
    const columns = batchColumns(["τ"]);
    const mk = (id: string, name: string): AnalysisBatchRow => ({ datasetId: id, name, rows: 5, status: "completed", values: [1, 1, 5, 1, 1, 0, id === "a" ? 1 : id === "b" ? 2 : 3, 0], warning: null });
    const rows = [mk("a", "run a"), mk("b", "run b"), mk("c", "run c")];
    const metas = [{ T: "300 K" }, { T: "100 K" }, {}];
    const inputs = rows.map((r, i) => ({ name: r.name, metadata: metas[i] }));
    const unsorted = batchSummaryData(rows, columns, "Exp", summaryX(inputs, { source: { kind: "meta", path: ["T"] }, sort: false }));
    expect(unsorted.time.slice(0, 2)).toEqual([300, 100]);
    expect(unsorted.time[2]).toBeNaN();
    expect(unsorted.metadata!.x_column_name).toBe("T");
    expect(unsorted.metadata!.x_column_unit).toBe("K");
    expect(unsorted.metadata!.summaryX).toMatchObject({ missing: ["run c: no T"] });
    const sorted = batchSummaryData(rows, columns, "Exp", summaryX(inputs, { source: { kind: "meta", path: ["T"] }, sort: true }));
    expect(sorted.time.slice(0, 2)).toEqual([100, 300]);
    // The rows travel with their X: run b's tau (2) is first, and the text columns follow.
    expect(sorted.values[0]![6]).toBe(2);
    expect((sorted.metadata!.text_columns as { Worksheet: string[] }).Worksheet).toEqual(["run b", "run a", "run c"]);
  });
});
