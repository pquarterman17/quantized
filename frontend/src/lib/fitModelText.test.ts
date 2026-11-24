import { describe, expect, it } from "vitest";

import type { AnalysisResult } from "./analysisResult";
import { buildFitModelBody, modelProblem } from "./fitModel";
import { fitModelRecipe } from "./fitModelRecipe";
import { fitModelTextColumns, isTextKey, textColumnKey, textDigest, textFactorValues } from "./fitModelText";
import type { DataStruct, Dataset } from "./types";

const DATA: DataStruct = {
  time: [0, 1, 2], values: [[1], [2], [3]], labels: ["y"], units: [""],
  metadata: { text_columns: { A: ["p", "q", "p"], B: ["x", "", "y"] }, origin_text_column_labels: { B: { long_name: "Batch" } } },
};
const DS: Dataset = { id: "d", name: "d", data: DATA };

describe("Fit Model text columns (provisional)", () => {
  it("exposes each text column as a virtual key <= -2, labelled and never the time axis", () => {
    const cols = fitModelTextColumns(DS);
    expect(cols.map((c) => [c.key, c.label])).toEqual([[-2, "A (text)"], [-3, "Batch (text)"]]);
    expect(cols.every((c) => isTextKey(c.key))).toBe(true);
    expect(isTextKey(-1)).toBe(false);
    expect(textColumnKey(1)).toBe(-3);
  });

  it("exposes none for a sampled (lazy preview) worksheet: a row index does not name a real row", () => {
    const pending = { bookId: "b", rows: 100, cols: 1, previewSampled: true } as unknown as Dataset["pending"];
    expect(fitModelTextColumns({ ...DS, pending })).toEqual([]);
  });

  it("reads cells at the fitted rows; blanks and missing cells are null", () => {
    const [, b] = fitModelTextColumns(DS);
    expect(textFactorValues(b!, [0, 1, 2, 7])).toEqual(["x", null, "y", null]);
  });

  it("digest changes with any cell and is absent without columns", () => {
    const [a] = fitModelTextColumns(DS);
    const edited = { ...a!, rows: ["p", "q", "q"] };
    expect(textDigest([a!])).not.toBe(textDigest([edited]));
    expect(textDigest([])).toBeUndefined();
  });

  it("the body refuses a text key with no values instead of reading the time axis", () => {
    const recipe = { responseCol: 0, terms: [[-2]], kinds: { "-2": "nominal" as const }, center: true };
    expect(() => buildFitModelBody(DATA, recipe, () => "A")).toThrow(/no values/);
  });

  it("modelProblem: text response refused; a vanished text column named", () => {
    const base = { terms: [[-2]], kinds: { "-2": "nominal" as const }, center: true };
    expect(modelProblem({ ...base, responseCol: -2, terms: [[0]], kinds: { "0": "continuous" } }, 1, 2)).toMatch(/numeric/);
    expect(modelProblem({ ...base, responseCol: 0 }, 1, 2)).toBeNull();
    expect(modelProblem({ ...base, responseCol: 0 }, 1, 0)).toMatch(/no longer exists/);
  });

  it("a saved recipe with text keys parses against its source and keeps the digest; a missing text column is refused", () => {
    const result = {
      producer: { id: "fit-model" },
      parameters: { recipe: { responseCol: 0, terms: [[-3]], kinds: { "-3": "nominal" }, center: true, textDigest: "abc12345" } },
    } as unknown as AnalysisResult;
    expect(fitModelRecipe(result, DS)?.textDigest).toBe("abc12345");
    const one = { ...DS, data: { ...DATA, metadata: { text_columns: { A: ["p"] } } } };
    expect(fitModelRecipe(result, one)).toBeNull();
  });
});
