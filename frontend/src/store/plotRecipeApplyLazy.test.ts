// COLD-path coverage for the Plot Recipe apply seam taken out of the eager
// bundle on 2026-09-18 (`plans/BUNDLE_HEADROOM.md` slice 3):
// `store/plotRecipes.ts` reaches `store/plotRecipeApply.ts` through
// `store/plotRecipeApplyLazy.ts`'s `applyCore()` / `applyCoreWithLibs()`
// instead of a static import.
//
// `src/architecture.test.ts` holds the STATIC half of the guard (its SEAMS
// list: nothing may value-import `plotRecipeApply` and the loader must reach
// it with a dynamic `import()`). This spec holds the BEHAVIOURAL half, which
// that grep cannot see:
//   * a save and an apply still land in the store, now one chunk fetch later;
//   * a chunk that will not load REJECTS the action's own promise instead of
//     resolving it as a silent, zero-effect success — and nothing mutates; and
//   * the failure is not cached: the next gesture refetches and succeeds.
//
// The rejection, not a toast, is the deliberate contract here, and it is not a
// new failure mode: `recipeLibs()` LIVES INSIDE `plotRecipeApply.ts` and is an
// unguarded `Promise.all` of two dynamic imports, so every one of these
// actions already rejected this way on a chunk failure. Reporting is UX-003's
// job for all of these sites at once (see `plans/BUGS_AND_ISSUES.md`); what
// this spec pins is that the seam did not quietly make a failure LOOK like
// success.
//
// `vi.doMock` (not the hoisted `vi.mock`) is what makes the failure path
// reachable: the seam resolves the module at CALL time, so a doMock registered
// just before the action runs is what that resolution sees.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, type PlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { useGlobalPlotRecipes } from "./globalPlotRecipes";
import { resetApplyCoreForTests } from "./plotRecipeApplyLazy";
import { useApp } from "./useApp";

function dataset(id: string): Dataset {
  return {
    id,
    name: `${id}.xy`,
    data: {
      time: [0, 1, 2],
      values: [[10, 100], [20, 200], [30, 300]],
      labels: ["2theta", "Intensity"],
      units: ["deg", "cps"],
      metadata: { technique: "xrd.powder" },
    },
  };
}

function focusPlotWindow(datasetId: string, viewOverrides: Partial<PlotView> = {}): string {
  const id = useApp.getState().createWindow(datasetId, { ...defaultPlotView(), ...viewOverrides }, "Win");
  useApp.getState().focusWindow(id);
  return id;
}

beforeEach(() => {
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
    facetKey: null,
    history: [],
    future: [],
    status: "",
  });
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: true });
  resetApplyCoreForTests();
});

afterEach(() => {
  vi.doUnmock("./plotRecipeApply");
  vi.resetModules();
  resetApplyCoreForTests();
});

/** Save a recipe off a real focused window, the way the UI does. */
async function savedRecipeId(): Promise<string> {
  focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
  const id = await useApp.getState().saveAsPlotRecipe("Cold", "d1");
  expect(id).not.toBeNull();
  return id as string;
}

describe("Plot Recipe apply — chunk-deferred core", () => {
  it("saves and then applies after loading its chunk", async () => {
    const id = await savedRecipeId();
    expect(useApp.getState().plotRecipes).toHaveLength(1);

    const windowsBefore = useApp.getState().plotWindows.length;
    const applied = await useApp.getState().applyPlotRecipe(id, "d1");

    expect(applied).toBe(true);
    // Applying a recipe always CREATES a figure window (the module doc's
    // "one gesture, one undo" contract) — the observable effect of the
    // deferred core actually having run.
    expect(useApp.getState().plotWindows.length).toBe(windowsBefore + 1);
  });

  it("still answers matchingPlotRecipes through the deferred core", async () => {
    const id = await savedRecipeId();
    resetApplyCoreForTests(); // force a second cold load for THIS action
    const matches = await useApp.getState().matchingPlotRecipes(useApp.getState().datasets[0]);
    expect(matches.map((r) => r.id)).toEqual([id]);
  });

  it("rejects the action instead of reporting a silent success when the chunk will not load", async () => {
    const id = await savedRecipeId();
    const windowsBefore = useApp.getState().plotWindows.length;
    const recipesBefore = useApp.getState().plotRecipes.length;

    resetApplyCoreForTests();
    vi.doMock("./plotRecipeApply", () => {
      throw new Error("network error");
    });

    // Rejects — asserted generically because vitest wraps a doMock factory
    // throw in its own message; what matters is that the promise REJECTS
    // rather than resolving `false`/`true` on a load that never happened.
    await expect(useApp.getState().applyPlotRecipe(id, "d1")).rejects.toThrow();
    // Nothing mutated: the load happens before any read or `set()`.
    expect(useApp.getState().plotWindows.length).toBe(windowsBefore);
    expect(useApp.getState().plotRecipes).toHaveLength(recipesBefore);
  });

  it("does not cache the failure — the next gesture refetches and applies", async () => {
    const id = await savedRecipeId();
    const windowsBefore = useApp.getState().plotWindows.length;

    resetApplyCoreForTests();
    vi.doMock("./plotRecipeApply", () => {
      throw new Error("network error");
    });
    await expect(useApp.getState().applyPlotRecipe(id, "d1")).rejects.toThrow();

    vi.doUnmock("./plotRecipeApply");
    vi.resetModules();
    expect(await useApp.getState().applyPlotRecipe(id, "d1")).toBe(true);
    expect(useApp.getState().plotWindows.length).toBe(windowsBefore + 1);
  });

  it("surfaces the loaded core's OWN failure rather than mistaking it for a load failure", async () => {
    // A core that loads fine but whose apply refuses must still refuse the way
    // it always did — `false` + a status line, NOT a rejection. This is the
    // pair to the test above: together they distinguish "the chunk did not
    // load" from "the chunk loaded and said no".
    await savedRecipeId();
    const applied = await useApp.getState().applyPlotRecipe("no-such-recipe", "d1");
    expect(applied).toBe(false);
    expect(useApp.getState().status).toContain("recipe not found");
  });
});
