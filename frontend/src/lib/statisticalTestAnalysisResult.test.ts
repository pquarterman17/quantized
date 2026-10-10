import { describe, expect, it } from "vitest";

import { analysisDataFingerprint } from "./analysisResultFreshness";
import { statisticalTestAnalysisResult, statisticalTestRecipe } from "./statisticalTestAnalysisResult";
import { DEFAULT_PARAMS, DEFAULT_SELECTION } from "./statsTests";
import type { Dataset } from "./types";

const source: Dataset = {
  id: "source", name: "measurements.csv",
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["A", "B"], units: ["V", "A"], metadata: {} },
};

describe("statisticalTestAnalysisResult", () => {
  it("keeps the exact question and compact tables without copying source samples", () => {
    const result = statisticalTestAnalysisResult(
      "result", source, "ks-two-sample", { ...DEFAULT_SELECTION, x: 0, y: 1 }, DEFAULT_PARAMS,
      ["A", "B"], { sentence: "No difference.", tables: [{ columns: ["statistic", "value"], rows: [["D", 0.2]] }] },
      "2026-10-10T00:00:00Z",
    );

    expect(result).toMatchObject({
      id: "result", name: "Two-sample Kolmogorov-Smirnov · measurements.csv",
      producer: { id: "statistical-test" },
      sources: [{ datasetId: "source", role: "input" }], outputs: [],
      selection: { channels: [{ index: 0, label: "A", unit: "V" }, { index: 1, label: "B", unit: "A" }] },
      scalarValues: { Interpretation: "No difference." },
      parameters: { testId: "ks-two-sample", labels: ["A", "B"] },
      tables: [{ columns: ["statistic", "value"], rows: [["D", 0.2]] }],
      sourceFingerprint: analysisDataFingerprint(source),
    });
    expect(JSON.stringify(result)).not.toContain("measurements.csv\",\"data");
    expect(statisticalTestRecipe(result)).toEqual({
      testId: "ks-two-sample",
      selection: { ...DEFAULT_SELECTION, x: 0, y: 1 },
      params: DEFAULT_PARAMS,
    });
  });

  it("supports source-free power calculations and normalizes non-finite result cells", () => {
    const result = statisticalTestAnalysisResult(
      "power", null, "power", DEFAULT_SELECTION, DEFAULT_PARAMS, [],
      { sentence: "n = 64", tables: [{ columns: ["n", "p"], rows: [[64, Number.NaN]] }] },
    );
    expect(result.sources).toEqual([]);
    expect(result).not.toHaveProperty("sourceFingerprint");
    expect(result.tables?.[0].rows).toEqual([[64, null]]);
  });

  it("refuses to rerun an incomplete or future saved question", () => {
    const result = statisticalTestAnalysisResult(
      "result", source, "anderson", DEFAULT_SELECTION, DEFAULT_PARAMS, ["A"],
      { sentence: "ok", tables: [] },
    );
    expect(statisticalTestRecipe({ ...result, parameters: { ...result.parameters, testId: "future-test" } })).toBeNull();
    expect(statisticalTestRecipe({ ...result, parameters: { ...result.parameters, params: { alpha: 0.05 } } })).toBeNull();
  });
});
