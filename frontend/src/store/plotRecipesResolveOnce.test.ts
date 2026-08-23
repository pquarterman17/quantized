// FINDING 6 (code-review, perf): cleanMatchingPlotRecipe must not re-resolve
// what an internal candidate pass already resolved -- each candidate gets
// exactly ONE `resolveRecipe` call, not two (the old bug: it called
// `matchingPlotRecipes`, which resolves every candidate once, and THEN
// resolved the first result AGAIN itself).
//
// Split into its OWN test file rather than living alongside
// store/plotRecipes.test.ts's other coverage: `store/plotRecipes.ts`'s
// `recipeLibs()` caches the dynamically-imported `lib/plotRecipeMatch.ts`
// module (and its `resolveRecipe` export) in a MODULE-LEVEL singleton the
// first time anything in the whole test FILE calls it -- so a spy installed
// partway through a long shared file (after many earlier tests already
// warmed that cache with the real, unspied function) silently never
// intercepts anything. Vitest gives each test FILE its own fresh module
// registry by default, so this file's spy is installed ONCE, at module
// scope, before ANY test body runs -- guaranteed to be the one
// `recipeLibs()`'s cache captures on its first-ever resolution in this file.
//
// A second subtlety this file works around: `recipeLibs()`'s cache is a
// PLAIN captured reference (`resolveRecipe: m.resolveRecipe`), not a live
// property lookup -- so even a per-`it()` `vi.spyOn` (a NEW mock object each
// time) would only ever be seen by whichever test happens to run first
// (whichever one triggers the cache's one-time resolution); every other
// test's own freshly-installed spy would silently see zero calls, since the
// store keeps calling through the FIRST test's spy object forever after.
// Installing ONE spy at module scope and `.mockClear()`-ing it per test
// (never re-`spyOn`-ing) sidesteps that entirely.

import { beforeEach, describe, expect, it, vi } from "vitest";

import * as plotRecipeMatch from "../lib/plotRecipeMatch";
import { defaultPlotView, type PlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { useGlobalPlotRecipes } from "./globalPlotRecipes";
import { useApp } from "./useApp";

function dataset(id: string, labels = ["2theta", "Intensity", "Ierr"]): Dataset {
  return {
    id,
    name: `${id}.xy`,
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels,
      units: ["deg", "cps", "cps"],
      metadata: { technique: "xrd.powder" },
    },
  };
}

function focusPlotWindow(datasetId: string, viewOverrides: Partial<PlotView> = {}): string {
  const view = { ...defaultPlotView(), ...viewOverrides };
  const id = useApp.getState().createWindow(datasetId, view, "Win");
  useApp.getState().focusWindow(id);
  return id;
}

// Installed ONCE, at module scope -- see the module doc above. Cleared (not
// re-spied) per test.
const resolveRecipeSpy = vi.spyOn(plotRecipeMatch, "resolveRecipe");

beforeEach(() => {
  resolveRecipeSpy.mockClear();
  useApp.setState({
    datasets: [dataset("d1")],
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    techniqueViewMemory: {},
    plotRecipes: [],
    pendingRecipeApplication: null,
    composition: null,
    history: [],
    future: [],
    status: "",
  });
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: true });
});

describe("finding 6 — each candidate is resolved exactly once", () => {
  it("cleanMatchingPlotRecipe calls resolveRecipe exactly once per candidate", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    await useApp.getState().saveAsPlotRecipe("A", "d1");
    await useApp.getState().saveAsPlotRecipe("B", "d1");
    resolveRecipeSpy.mockClear(); // saveAsPlotRecipe itself never calls resolveRecipe, but keep the count honest

    await useApp.getState().cleanMatchingPlotRecipe(useApp.getState().datasets[0]);

    expect(resolveRecipeSpy).toHaveBeenCalledTimes(2); // 2 candidates, ONE resolve each -- never 4
  });

  it("matchingPlotRecipes ALSO resolves each candidate exactly once (the shared helper, not a second code path)", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    await useApp.getState().saveAsPlotRecipe("A", "d1");
    resolveRecipeSpy.mockClear();

    await useApp.getState().matchingPlotRecipes(useApp.getState().datasets[0]);

    expect(resolveRecipeSpy).toHaveBeenCalledTimes(1);
  });
});
