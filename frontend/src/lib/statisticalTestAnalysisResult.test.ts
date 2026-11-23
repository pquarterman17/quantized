import { describe, expect, it } from "vitest";

import { sanitizeAnalysisResults } from "./analysisResult";
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

  it("reopens a result saved before the adjust / expected-counts params existed, and refuses invalid ones", () => {
    const result = statisticalTestAnalysisResult(
      "r", source, "adjust-p", { ...DEFAULT_SELECTION, x: 0 }, DEFAULT_PARAMS, ["A"],
      { sentence: "ok", tables: [{ columns: ["a"], rows: [[1]] }] },
    );
    const params = result.parameters as unknown as { params: Record<string, unknown> };
    const withParams = (p: Record<string, unknown>) => ({ ...result, parameters: { ...params, params: p } }) as unknown as typeof result;
    const { adjustMethod: _a, gofExpected: _g, ...legacy } = params.params;
    expect(statisticalTestRecipe(withParams(legacy))?.params)
      .toMatchObject({ adjustMethod: "holm", gofExpected: "uniform" });
    expect(statisticalTestRecipe(withParams({ ...legacy, adjustMethod: "sidak" }))).toBeNull();
    expect(statisticalTestRecipe(withParams({ ...legacy, gofExpected: "other" }))).toBeNull();
    // ... and one saved before the survival grouping flag existed.
    const { survivalGroups: _s, ...beforeSurvival } = { ...legacy, adjustMethod: "holm", gofExpected: "uniform", survivalGroups: true };
    expect(statisticalTestRecipe(withParams(beforeSurvival))?.params.survivalGroups).toBe(false);
    expect(statisticalTestRecipe(withParams({ ...beforeSurvival, survivalGroups: "yes" }))).toBeNull();
  });

  it("records only the columns a chi-square test reads (no expected column when uniform)", () => {
    const sel = { ...DEFAULT_SELECTION, x: 0, y: 1 };
    const out = { sentence: "ok", tables: [{ columns: ["a"], rows: [[1]] }] };
    const uniform = statisticalTestAnalysisResult("u", source, "chi-square-gof", sel, DEFAULT_PARAMS, ["A"], out);
    const column = statisticalTestAnalysisResult("c", source, "chi-square-gof", sel, { ...DEFAULT_PARAMS, gofExpected: "column" }, ["A", "B"], out);
    expect(uniform.selection?.channels.map((c) => c.index)).toEqual([0]);
    expect(column.selection?.channels.map((c) => c.index)).toEqual([0, 1]);
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

  it("caps saved tables to the envelope bounds with a warning instead of a silent drop on reopen", () => {
    const wide = { title: "Partial r", columns: Array.from({ length: 300 }, (_, i) => `c${i}`), rows: [Array(300).fill(1)] };
    const tall = { title: "Comparisons", columns: ["pair", "p"], rows: Array.from({ length: 12_000 }, (_, i) => [`g${i}`, 0.5]) };
    const result = statisticalTestAnalysisResult(
      "result", source, "anderson", DEFAULT_SELECTION, DEFAULT_PARAMS, ["A"],
      { sentence: "ok", tables: [{ columns: ["statistic", "value"], rows: [["A²", 0.2]] }, wide, tall] },
    );
    expect(result.tables?.map((table) => table.title ?? "main")).toEqual(["main", "Comparisons"]);
    expect(result.tables?.[1].rows).toHaveLength(10_000);
    expect(result.warnings).toEqual([
      expect.stringContaining('"Partial r" was too large'),
      expect.stringContaining('"Comparisons" was saved with 10000 of 12000 rows'),
    ]);
    // The bounded envelope survives the reopen sanitizer intact.
    const [reopened] = sanitizeAnalysisResults([JSON.parse(JSON.stringify(result))]);
    expect(reopened.tables).toEqual(result.tables);
    expect(reopened.warnings).toEqual(result.warnings);
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

describe("statisticalTestAnalysisResult records its input (acceptance C9)", () => {
  const out = { sentence: "No difference.", tables: [{ columns: ["statistic", "value"], rows: [["D", 0.2]] }] };
  const run = (data: Dataset | null) => statisticalTestAnalysisResult(
    "result", data, "ks-two-sample", { ...DEFAULT_SELECTION, x: 0, y: 1 }, DEFAULT_PARAMS, ["A", "B"], out, "2026-10-10T00:00:00Z");
  it("records channels, units, included rows out of total and the X range of the included rows", () => {
    expect(run({ ...source, excludedRows: [0] }).parameters?.["inputs"]).toMatchObject({ total: 1, items: [{
      datasetId: "source", rows: 2, includedRows: 1, xRange: null, channels: [{ label: "A", unit: "V" }, { label: "B", unit: "A" }],
    }] });
  });
  it("records nothing when the test ran without a worksheet", () => {
    expect(run(null).parameters).not.toHaveProperty("inputs");
  });
});
