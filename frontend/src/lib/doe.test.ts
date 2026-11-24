import { describe, expect, it } from "vitest";

import { designTitle, doeEffectsBody, doeFitRecipe, doeMeta, filledResponses } from "./doe";
import { designData } from "./doeTestData";

describe("doe metadata", () => {
  it("reads a design record and refuses a plain worksheet or a malformed one", () => {
    expect(doeMeta(designData())?.factors).toHaveLength(2);
    expect(doeMeta({ ...designData(), metadata: {} })).toBeNull();
    expect(doeMeta({ ...designData(), metadata: { doe: { factors: [] } } })).toBeNull();
    expect(doeMeta(null)).toBeNull();
  });

  it("builds Fit Model's recipe on the coded columns by label", () => {
    const r = doeFitRecipe(designData())!;
    expect(r.responseCol).toBe(6);
    expect(r.terms).toEqual([[2], [3], [2, 3]]);
    expect(r.kinds).toEqual({ 2: "continuous", 3: "continuous" });
    expect(r.center).toBe(true);
  });

  it("fails closed when a design column was renamed", () => {
    const d = designData();
    d.labels[2] = "A renamed";
    expect(doeFitRecipe(d)).toBeNull();
    expect(doeEffectsBody(d)).toBeNull();
  });

  it("counts filled responses and builds the effects request for two-level designs only", () => {
    expect(filledResponses(designData())).toBe(0);
    const d = designData([1, 2, 3, null]);
    expect(filledResponses(d)).toBe(3);
    const body = doeEffectsBody(d)!;
    expect(body.response).toEqual([1, 2, 3, null]);
    expect(body.factor_columns["A (coded)"]).toEqual([-1, 1, -1, 1]);
    expect(body.terms).toHaveLength(3);
    const q = designData();
    (q.metadata["doe"] as { model: string }).model = "quadratic";
    expect(doeEffectsBody(q)).toBeNull();
  });

  it("titles a design", () => {
    expect(designTitle(doeMeta(designData())!)).toBe("2^2 full factorial");
  });
});
