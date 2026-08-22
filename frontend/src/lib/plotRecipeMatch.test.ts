// P1.3 plot recipe matching (plotRecipeMatch.ts): technique gate, label/
// alias re-key, the unit trap, and the errorRole guard.

import { describe, expect, it } from "vitest";

import { captureRecipe, type PlotRecipe } from "./plotRecipe";
import { resolveRecipe } from "./plotRecipeMatch";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";

function xrdDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "xrd-scan.xy",
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels: ["2theta", "Intensity", "Ierr"],
      units: ["deg", "cps", "cps"],
      metadata: { technique: "xrd.powder" },
    },
    ...overrides,
  };
}

function view(overrides: Partial<PlotView> = {}): PlotView {
  return { ...defaultPlotView(), ...overrides };
}

function xrdRecipe(): PlotRecipe {
  const ds = xrdDataset();
  const v = view({ xKey: 0, yKeys: [1], errKeys: { 1: 2 } });
  return captureRecipe(ds, v, null, { id: "r1", name: "XRD standard", appVersion: "0" });
}

describe("resolveRecipe — capture round-trip", () => {
  it("resolves an unchanged dataset with zero unmatched and apply-equivalent indices", () => {
    const recipe = xrdRecipe();
    const res = resolveRecipe(recipe, xrdDataset());
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.resolved.mapping).toEqual({
      xKey: 0,
      yKeys: [1],
      y2Keys: [],
      groupKey: null,
      facetKey: null,
      errors: [{ channel: 2, target: 1, axis: "y", side: "both" }],
    });
  });
});

describe("resolveRecipe — reordered columns (P1.3 acceptance case)", () => {
  it("reordered equivalent XRD columns map correctly by label, not position", () => {
    const recipe = xrdRecipe();
    // Same three columns, same technique, different order + different
    // channel indices throughout.
    const reordered = xrdDataset({
      data: {
        time: [0, 1, 2],
        values: [[100, 1, 10], [200, 2, 20], [300, 3, 30]],
        labels: ["Intensity", "Ierr", "2theta"],
        units: ["cps", "cps", "deg"],
        metadata: { technique: "xrd.powder" },
      },
    });
    const res = resolveRecipe(recipe, reordered);
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual([]);
    expect(res.resolved.mapping).toEqual({
      xKey: 2,
      yKeys: [0],
      y2Keys: [],
      groupKey: null,
      facetKey: null,
      errors: [{ channel: 1, target: 0, axis: "y", side: "both" }],
    });
  });

  it("the SAME recipe is never auto-applied to a SIMS dataset with identical column shape", () => {
    const recipe = xrdRecipe();
    const sims = xrdDataset({ data: { ...xrdDataset().data, metadata: { technique: "sims" } } });
    const res = resolveRecipe(recipe, sims);
    expect("refused" in res).toBe(true);
    if ("refused" in res) expect(res.refused).toMatch(/xrd\.powder.*sims/);
  });
});

describe("resolveRecipe — unit trap", () => {
  it("a same-label column with a changed unit is unmatched, with a warning naming both units", () => {
    const recipe = xrdRecipe();
    const rotatedUnit = xrdDataset({
      data: { ...xrdDataset().data, units: ["rad", "cps", "cps"] }, // "2theta" now in rad, not deg
    });
    const res = resolveRecipe(recipe, rotatedUnit);
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual(['X axis ("2theta")']);
    expect(res.warnings).toEqual(['X axis ("2theta"): unit changed (saved "deg", now "rad")']);
    // The unit-mismatched channel is excluded from the apply, but the rest
    // of the recipe still resolves -- soft failure, not a hard refusal.
    expect(res.resolved.mapping.xKey).toBeNull();
    expect(res.resolved.mapping.yKeys).toEqual([1]);
  });

  it("an entry captured with NO unit skips the unit check entirely", () => {
    const ds = xrdDataset({ data: { ...xrdDataset().data, units: ["", "cps", "cps"] } });
    const recipe = captureRecipe(ds, view({ xKey: 0, yKeys: [1] }), null, { id: "r", name: "n", appVersion: "0" });
    const differentUnit = xrdDataset({ data: { ...xrdDataset().data, units: ["rad", "cps", "cps"] } });
    const res = resolveRecipe(recipe, differentUnit);
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual([]);
    expect(res.resolved.mapping.xKey).toBe(0);
  });
});

describe("resolveRecipe — errorRole guard", () => {
  it("refuses (does not silently partial-apply) when a saved error channel is no longer classified as one", () => {
    const recipe = xrdRecipe();
    // "Ierr" moved to channel 0, with no preceding value column to bind to --
    // inferErrorBindings no longer classifies it as an error column at all,
    // so its live errorRole is now "value" while the recipe captured it as
    // "error-y". Applying it would rebind a value column onto error-whisker
    // duty (or vice versa) -- the exact trap the guard exists for.
    const moved = xrdDataset({
      data: {
        time: [0, 1, 2],
        values: [[1, 10, 100], [2, 20, 200], [3, 30, 300]],
        labels: ["Ierr", "2theta", "Intensity"],
        units: ["cps", "deg", "cps"],
        metadata: { technique: "xrd.powder" },
      },
    });
    const res = resolveRecipe(recipe, moved);
    expect("refused" in res).toBe(true);
    if ("refused" in res) {
      expect(res.refused).toMatch(/Ierr/);
      expect(res.refused).toMatch(/error-y/);
      expect(res.refused).toMatch(/value/);
    }
  });
});

describe("resolveRecipe — alias resolution", () => {
  it("a current channel matching a signature alias (case-insensitively) resolves to that entry", () => {
    const recipe = xrdRecipe();
    const aliased: PlotRecipe = {
      ...recipe,
      signature: recipe.signature.map((e) => (e.id === "x0" ? { ...e, aliases: ["Two Theta"] } : e)),
    };
    const renamed = xrdDataset({
      data: { ...xrdDataset().data, labels: ["two theta", "Intensity", "Ierr"] },
    });
    const res = resolveRecipe(aliased, renamed);
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual([]);
    expect(res.resolved.mapping.xKey).toBe(0);
  });

  it("without the alias, the same renamed dataset leaves the field unmatched", () => {
    const recipe = xrdRecipe();
    const renamed = xrdDataset({
      data: { ...xrdDataset().data, labels: ["two theta", "Intensity", "Ierr"] },
    });
    const res = resolveRecipe(recipe, renamed);
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual(['X axis ("2theta")']);
    expect(res.resolved.mapping.xKey).toBeNull();
  });
});

describe("resolveRecipe — technique scope", () => {
  it("\"generic\" recipes never match, even against another generic dataset", () => {
    const ds = xrdDataset({ data: { ...xrdDataset().data, metadata: {} } }); // no technique tag -> "generic"
    const recipe: PlotRecipe = { ...xrdRecipe(), technique: "generic" };
    const res = resolveRecipe(recipe, ds);
    expect("refused" in res).toBe(true);
    if ("refused" in res) expect(res.refused).toMatch(/generic/);
  });

  it("cross-technique refusal names both techniques", () => {
    const recipe = xrdRecipe();
    const magnetometry = xrdDataset({ data: { ...xrdDataset().data, metadata: { technique: "magnetometry.mvsh" } } });
    const res = resolveRecipe(recipe, magnetometry);
    expect("refused" in res).toBe(true);
    if ("refused" in res) expect(res.refused).toMatch(/xrd\.powder/);
  });
});

describe("resolveRecipe — ambiguous label matching (case-duplicate columns)", () => {
  it("a folded-label duplicate with no exact match is ambiguous: unmatched + a warning naming every candidate", () => {
    // Captured from a dataset where the Y series was labeled "Pass" exactly.
    const captureDs = xrdDataset({
      data: {
        time: [0, 1],
        values: [[0, 1], [0, 1]],
        labels: ["X", "Pass"],
        units: ["", ""],
        metadata: { technique: "xrd.powder" },
      },
    });
    const recipe = captureRecipe(captureDs, view({ xKey: 0, yKeys: [1] }), null, {
      id: "r",
      name: "n",
      appVersion: "0",
    });
    // Resolve against a dataset with NEITHER column spelled "Pass" exactly --
    // "pass" and "PASS" both fold to the same normalized label, and #186's
    // review-round precedent (case-sensitive, non-deduped backend encoding +
    // in-app rename/find-replace) means this shape is reachable in practice.
    const dup = xrdDataset({
      data: {
        time: [0, 1],
        values: [[0, 1], [0, 1], [0, 1]],
        labels: ["X", "pass", "PASS"],
        units: ["", "", ""],
        metadata: { technique: "xrd.powder" },
      },
    });
    const res = resolveRecipe(recipe, dup);
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual(['Y series ("Pass")']);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/ambiguous/i);
    expect(res.warnings[0]).toContain("pass");
    expect(res.warnings[0]).toContain("PASS");
    // Neither candidate is silently picked -- the field is dropped entirely.
    expect(res.resolved.mapping.yKeys).toEqual([]);
  });

  it("an EXACT unique raw-string match beats a folded duplicate elsewhere in the dataset", () => {
    const captureDs = xrdDataset({
      data: {
        time: [0, 1],
        values: [[0, 1], [0, 1]],
        labels: ["X", "B"],
        units: ["", ""],
        metadata: { technique: "xrd.powder" },
      },
    });
    const recipe = captureRecipe(captureDs, view({ xKey: 0, yKeys: [1] }), null, {
      id: "r",
      name: "n",
      appVersion: "0",
    });
    // "B" is exact and unique even though "b" also appears -- the exact tier
    // must win outright, never fall through to the ambiguous folded tier.
    const withDup = xrdDataset({
      data: {
        time: [0, 1],
        values: [[0, 1], [0, 1], [0, 1]],
        labels: ["X", "B", "b"],
        units: ["", "", ""],
        metadata: { technique: "xrd.powder" },
      },
    });
    const res = resolveRecipe(recipe, withDup);
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual([]);
    expect(res.warnings).toEqual([]);
    expect(res.resolved.mapping.xKey).toBe(0);
    expect(res.resolved.mapping.yKeys).toEqual([1]);
  });
});

describe("resolveRecipe — cross-entry collision", () => {
  it("two entries independently resolving to the SAME channel (alias vs. label) both drop, with one collision warning", () => {
    const captureDs = xrdDataset({
      data: {
        time: [0, 1],
        values: [[0, 1], [0, 1]],
        labels: ["Field", "H"],
        units: ["", ""],
        metadata: { technique: "xrd.powder" },
      },
    });
    const recipe = captureRecipe(captureDs, view({ xKey: 0, yKeys: [], groupKey: 1 }), null, {
      id: "r",
      name: "n",
      appVersion: "0",
    });
    // Give the group entry ("H") an alias of "Field" -- the SAME string the
    // x entry's own label already is. On a dataset with exactly one column
    // named "Field", both entries individually resolve unambiguously (x0 by
    // exact label, group0 by exact-folded alias) -- but to the SAME index.
    const aliased: PlotRecipe = {
      ...recipe,
      signature: recipe.signature.map((e) => (e.role === "group" ? { ...e, aliases: ["Field"] } : e)),
    };
    const resolveDs = xrdDataset({
      data: {
        time: [0, 1],
        values: [[0, 1], [0, 1], [0, 1]],
        labels: ["Something", "Other", "Field"],
        units: ["", "", ""],
        metadata: { technique: "xrd.powder" },
      },
    });
    const res = resolveRecipe(aliased, resolveDs);
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual(expect.arrayContaining(['X axis ("Field")', 'Group ("H")']));
    expect(res.unmatched).toHaveLength(2);
    expect(res.warnings.some((w) => w.includes("Field") && w.includes("H"))).toBe(true);
    // Neither entry wins the shared column -- both drop out of the mapping.
    expect(res.resolved.mapping.xKey).toBeNull();
    expect(res.resolved.mapping.groupKey).toBeNull();
  });
});

describe("resolveRecipe — seriesStyles/seriesOrder/hiddenChannels re-key", () => {
  it("re-keys visual overrides from signature ids back to real channel indices", () => {
    const ds = xrdDataset();
    const styled = view({
      xKey: 0,
      yKeys: [1],
      seriesStyles: { 1: { color: "#ff0000" } },
      seriesOrder: [1],
      hiddenChannels: [1],
    });
    const recipe = captureRecipe(ds, styled, null, { id: "r", name: "n", appVersion: "0" });
    const reordered = xrdDataset({
      data: {
        time: [0, 1, 2],
        values: [[100, 1, 10], [200, 2, 20], [300, 3, 30]],
        labels: ["Intensity", "Ierr", "2theta"],
        units: ["cps", "cps", "deg"],
        metadata: { technique: "xrd.powder" },
      },
    });
    const res = resolveRecipe(recipe, reordered);
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.resolved.visual.seriesStyles).toEqual({ 0: { color: "#ff0000" } });
    expect(res.resolved.visual.seriesOrder).toEqual([0]);
    expect(res.resolved.visual.hiddenChannels).toEqual([0]);
  });
});
