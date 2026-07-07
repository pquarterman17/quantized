// lib/peakwizard — range cut, baseline subtract, regions, recipe persistence (#31/#32).

import { beforeEach, describe, expect, it } from "vitest";

import {
  cutRange,
  DEFAULT_RECIPE,
  deleteRecipe,
  expandToFullRows,
  loadRecipes,
  regionsFromPeaks,
  saveRecipe,
  subtractBaseline,
  type PeakRecipe,
} from "./peakwizard";

describe("cutRange", () => {
  const x = [1, 2, 3, 4, 5];
  const y = [10, 20, 30, 40, 50];

  it("keeps points inside [lo, hi] and reports kept indices", () => {
    const cut = cutRange(x, y, 2, 4);
    expect(cut.x).toEqual([2, 3, 4]);
    expect(cut.y).toEqual([20, 30, 40]);
    expect(cut.kept).toEqual([1, 2, 3]);
  });

  it("treats null bounds as open ends", () => {
    expect(cutRange(x, y, null, 2).x).toEqual([1, 2]);
    expect(cutRange(x, y, 4, null).x).toEqual([4, 5]);
    expect(cutRange(x, y, null, null).x).toEqual(x);
  });
});

describe("subtractBaseline / expandToFullRows", () => {
  it("subtracts pointwise and passes null baseline points through", () => {
    expect(subtractBaseline([10, 20, 30], [1, null, 3])).toEqual([9, 20, 27]);
  });

  it("expands a cut-segment array back to full rows with nulls elsewhere", () => {
    expect(expandToFullRows([9, 27], [1, 3], 5)).toEqual([null, 9, null, 27, null]);
  });
});

describe("regionsFromPeaks", () => {
  it("builds center ± width·FWHM/2 windows clamped to the data range", () => {
    const regions = regionsFromPeaks(
      [
        { center: 5, fwhm: 2 },
        { center: 9.5, fwhm: 2 },
      ],
      3,
      0,
      10,
    );
    expect(regions[0]).toEqual([2, 8]); // 5 ± 3
    expect(regions[1]).toEqual([6.5, 10]); // clamped at xMax
  });

  it("falls back to a 2% window for a zero-FWHM peak", () => {
    const [r] = regionsFromPeaks([{ center: 5, fwhm: 0 }], 3, 0, 100);
    expect(r[1] - r[0]).toBeCloseTo(4); // 2 × (100/50)
  });
});

describe("recipe persistence", () => {
  beforeEach(() => localStorage.clear());

  const recipe = (name: string): PeakRecipe => ({ ...DEFAULT_RECIPE, name });

  it("saves, upserts by name, and deletes", () => {
    saveRecipe(recipe("xrd"));
    saveRecipe(recipe("moke"));
    expect(loadRecipes().map((r) => r.name)).toEqual(["xrd", "moke"]);
    saveRecipe({ ...recipe("xrd"), report: { mode: "integrate", regionWidth: 2 } });
    const list = loadRecipes();
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.name === "xrd")?.report.mode).toBe("integrate");
    expect(deleteRecipe("xrd").map((r) => r.name)).toEqual(["moke"]);
  });

  it("survives corrupt storage and drops malformed entries", () => {
    localStorage.setItem("qz.peakRecipes", "not json");
    expect(loadRecipes()).toEqual([]);
    localStorage.setItem("qz.peakRecipes", JSON.stringify([recipe("ok"), { version: 2 }, null]));
    expect(loadRecipes().map((r) => r.name)).toEqual(["ok"]);
  });
});
