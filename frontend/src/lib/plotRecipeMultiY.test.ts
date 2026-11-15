// Review M4 (gap audit 4 G11): a plot recipe carries the Y3+ axes -- each
// axis' settings and which channel (by signature id) rides which axis -- so
// saving one from a multi-Y graph and applying it does not silently put those
// series on Y1. Validated on load like a .dwk.

import { describe, expect, it } from "vitest";

import { captureRecipe, serializeRecipe } from "./plotRecipe";
import { parseRecipe } from "./plotRecipeIO";
import { resolveRecipe } from "./plotRecipeMatch";
import { resolvedRecipeView } from "./plotRecipeView";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";

const ds = (labels: string[]): Dataset => ({
  id: "d",
  name: "transport.csv",
  data: { time: [0, 1, 2], values: [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]], labels, units: labels.map((l) => UNIT[l]), metadata: {} },
});
const UNIT: Record<string, string> = { T: "K", R: "ohm", M: "emu", P: "mbar" };
const Y3 = { lim: [0, 9] as [number, number], scale: "log" as const, step: null, fmt: null, label: "Moment", color: "#aa0000" };

function apply(source: Dataset, view: PlotView, target: Dataset): PlotView {
  const recipe = parseRecipe(serializeRecipe(captureRecipe(source, view, null, { id: "r", name: "multi", appVersion: "t" })));
  const res = resolveRecipe(recipe, target);
  if ("refused" in res) throw new Error(res.refused);
  let n = 0;
  return resolvedRecipeView(res.resolved.mapping, res.resolved.visual, () => `ref-${n++}`);
}

describe("plot recipes and Y3+ axes", () => {
  const view: PlotView = { ...defaultPlotView(), yKeys: [0, 1, 2, 3], y2Keys: [1], yAxes: [Y3], yAxisOf: { 2: 3 } };

  it("round-trips the axes and the assignment onto the same columns", () => {
    const out = apply(ds(["T", "R", "M", "P"]), view, ds(["T", "R", "M", "P"]));
    expect(out.yAxes).toEqual([Y3]);
    expect(out.yAxisOf).toEqual({ 2: 3 });
    expect(out.y2Keys).toEqual([1]);
  });

  it("re-keys the assignment to the target's column of the same name", () => {
    const out = apply(ds(["T", "R", "M", "P"]), view, ds(["M", "T", "R", "P"]));
    expect(out.yAxisOf).toEqual({ 0: 3 });
  });

  it("a recipe from a single-axis graph carries none", () => {
    const plain = { ...defaultPlotView(), yKeys: [0, 1] };
    const recipe = captureRecipe(ds(["T", "R", "M", "P"]), plain, null, { id: "r", name: "p", appVersion: "t" });
    expect(recipe.visual.yAxes).toBeUndefined();
  });

  it("a damaged saved assignment is dropped on load", () => {
    const recipe = JSON.parse(serializeRecipe(captureRecipe(ds(["T", "R", "M", "P"]), view, null, { id: "r", name: "m", appVersion: "t" })));
    const id = Object.keys(recipe.visual.yAxisOf)[0];
    recipe.visual.yAxisOf = { [id]: 99, other: 3 };
    recipe.visual.yAxes = [{ ...Y3, color: "red", lim: [5, 1] }];
    const loaded = parseRecipe(JSON.stringify(recipe));
    expect(loaded.visual.yAxisOf).toEqual({ other: 3 });
    expect(loaded.visual.yAxes?.[0]).toMatchObject({ color: null, lim: null, label: "Moment" });
  });
});
