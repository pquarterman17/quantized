import { describe, expect, it } from "vitest";

import { designTitle, doeEffectsBody, doeFitRecipe, doeMeta, isTwoLevel } from "./doe";
import { designData } from "./doeTestData";
import type { DataStruct } from "./types";

// designData() with a Block column after PointType, as calc/doe_sheet.py lays out a blocked design.
function blocked(): DataStruct {
  const d = designData([1, 2, 3, 4]);
  const block = [0, 1, 1, 0];
  const meta = d.metadata["doe"] as Record<string, unknown>;
  return {
    ...d,
    values: d.values.map((r, i) => [r[0]!, r[1]!, block[i]!, ...r.slice(2)]),
    labels: ["StdOrder", "PointType", "Block", "A (coded)", "B (coded)", "A", "B", "Y"],
    units: ["", "", "", "", "", "C", "", ""],
    metadata: { ...d.metadata, doe: { ...meta, block_label: "Block", blocks: 2, block_generators: ["AB"], confounded: ["AB"], terms: [["A"], ["B"]], terms_coded: [["A (coded)"], ["B (coded)"]] } },
    cat_levels: { 1: ["factorial", "axial", "center"], 2: ["1", "2"] },
  };
}

describe("blocked designs", () => {
  it("Fit Model gets Block as a nominal fixed effect after the design's terms", () => {
    const r = doeFitRecipe(blocked())!;
    expect(r.responseCol).toBe(7);
    expect(r.terms).toEqual([[3], [4], [2]]);
    expect(r.kinds).toEqual({ 2: "nominal", 3: "continuous", 4: "continuous" });
  });

  it("fails closed when the Block column was renamed or removed", () => {
    const d = blocked();
    d.labels[2] = "Blk";
    expect(doeFitRecipe(d)).toBeNull();
  });

  it("an unblocked design has no Block term", () => {
    expect(doeFitRecipe(designData())!.terms).toEqual([[2], [3], [2, 3]]);
  });

  it("titles the block count and still offers effects", () => {
    expect(designTitle(doeMeta(blocked())!)).toBe("2^2 full factorial in 2 blocks");
    expect(doeEffectsBody(blocked())!.terms).toEqual([["A (coded)"], ["B (coded)"]]);
  });
});

describe("D-optimal designs", () => {
  function optimal(): DataStruct {
    const d = designData([1, 2, 3, 4]);
    const meta = d.metadata["doe"] as Record<string, unknown>;
    const factors = (meta["factors"] as Record<string, unknown>[]).map((f, i) => (i === 1 ? { ...f, coded_label: "B", levels: ["x", "y"] } : f));
    return {
      ...d,
      metadata: { ...d.metadata, doe: { ...meta, kind: "d_optimal", model: "main", factors, terms: [["A"], ["B"]], terms_coded: [["A (coded)"], ["B"]], d_efficiency: 88.5 } },
    };
  }

  it("a categorical factor is analysed through its own nominal column", () => {
    const r = doeFitRecipe(optimal())!;
    expect(r.terms).toEqual([[2], [5]]);
    expect(r.kinds).toEqual({ 2: "continuous", 5: "nominal" });
  });

  it("is not a two-level design (no contrast-effects view) and has a title", () => {
    const meta = doeMeta(optimal())!;
    expect(isTwoLevel(meta)).toBe(false);
    expect(doeEffectsBody(optimal())).toBeNull();
    expect(designTitle(meta)).toBe("D-optimal 4-run");
  });
});
