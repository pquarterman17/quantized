// PRIMARY_SOFTWARE_AUDIT_PLAN — "Migration fixtures for supported
// contract/workspace versions". Exercises the FROZEN v1 fixture in
// `./__fixtures__/peakRecipes/` (see that directory's README for
// provenance) through the REAL public load path (`loadRecipesChecked`,
// reading the same `localStorage` key the app writes).

import { beforeEach, describe, expect, it } from "vitest";

import v1 from "./__fixtures__/peakRecipes/v1.json";
import { DEFAULT_FIT } from "./peakRecipeFit";
import { loadRecipesChecked, PEAK_RECIPE_VERSION, saveRecipe } from "./peakwizard";

const KEY = "qz.peakRecipes";

beforeEach(() => {
  localStorage.clear();
});

describe("peak recipe migration — frozen v1 fixture", () => {
  it("migrates to v2 with the default fit section attached, silently (no warning)", () => {
    localStorage.setItem(KEY, JSON.stringify(v1));
    const { recipes, warnings } = loadRecipesChecked();
    expect(warnings).toEqual([]);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].version).toBe(PEAK_RECIPE_VERSION);
    expect(recipes[0].fit).toEqual(DEFAULT_FIT);
  });

  it("range/baseline/find/model/report survive verbatim", () => {
    localStorage.setItem(KEY, JSON.stringify(v1));
    const { recipes } = loadRecipesChecked();
    const [r] = recipes;
    expect(r.name).toBe("XRD default");
    expect(r.range).toEqual({ lo: 10, hi: 80 });
    expect(r.baseline).toEqual({ method: "als", lam: 100000, p: 0.01, radius: 50, order: 2 });
    expect(r.find).toEqual({ snr_threshold: 3, min_prominence: 0, max_peaks: 20 });
    expect(r.model).toEqual({ shape: "Gaussian", bgDegree: 1, linkMode: "None", constrain: false });
    expect(r.report).toEqual({ mode: "fit", regionWidth: 3 });
  });

  it("re-saving then reloading is idempotent (round trip stable)", () => {
    localStorage.setItem(KEY, JSON.stringify(v1));
    const { recipes: firstLoad } = loadRecipesChecked();
    saveRecipe(firstLoad[0]);
    const { recipes: secondLoad, warnings } = loadRecipesChecked();
    expect(warnings).toEqual([]);
    expect(secondLoad).toEqual(firstLoad);
  });

  it("a future version this build does not understand is skipped with a named warning", () => {
    const future = { ...(v1 as unknown[])[0] as Record<string, unknown>, name: "future", version: PEAK_RECIPE_VERSION + 1 };
    localStorage.setItem(KEY, JSON.stringify([future]));
    const { recipes, warnings } = loadRecipesChecked();
    expect(recipes).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("future");
  });
});
