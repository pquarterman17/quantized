// The `recipeLibs()` half of the plot-recipe apply seam (bundle headroom
// slice 3, `plans/BUNDLE_HEADROOM.md`): `store/plotRecipeApply.ts`'s own
// `_recipeLibs` cache, separate from `plotRecipeApplyLazy.ts`'s `inflight`
// slot (see `plotRecipeApplyLazy.test.ts` for that half).
//
// Review finding (slice-3 round): `recipeLibs()` did NOT reset `_recipeLibs`
// on rejection, so a transient failure loading `lib/plotRecipe` /
// `lib/plotRecipeMatch` made every LATER save/apply/confirm/match gesture
// reject forever, for the rest of the session, with no way to retry short of
// a full page reload. Fixed by adding the same `.catch`-nulls-the-slot
// pattern `plotRecipeApplyLazy.ts`'s `inflight` already uses.
//
// This spec is deliberately its OWN file, not folded into
// `plotRecipeApplyLazy.test.ts`: `vi.doUnmock` alone (no `vi.resetModules`)
// is what a real session gets on a transient failure, and that is the one
// thing this spec has to prove — but `vi.doMock`'s retry-without-reset
// behavior for a module ANOTHER test in the same file has already loaded for
// real is not reliable in this Vitest version (measured: green as the only
// mocking test in a file / in a file of its own, red once a PRECEDING test
// in the same file has already run a `vi.resetModules()` cycle, regardless
// of what that test mocked). Keeping this the file's only test sidesteps
// that order-dependence rather than papering over it with a looser test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView } from "../lib/plotview";
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
  vi.doUnmock("../lib/plotRecipe");
  vi.resetModules();
  resetApplyCoreForTests();
});

describe("recipeLibs half of the seam", () => {
  it("does not cache a failed lib load — vi.doUnmock alone (no resetModules) is enough to retry", async () => {
    const wid = useApp.getState().createWindow("d1", { ...defaultPlotView(), xKey: 0, yKeys: [1] }, "Win");
    useApp.getState().focusWindow(wid);

    vi.doMock("../lib/plotRecipe", () => {
      throw new Error("network error");
    });
    await expect(useApp.getState().saveAsPlotRecipe("Cold", "d1")).rejects.toThrow();
    expect(useApp.getState().plotRecipes).toHaveLength(0);

    // The "transient" failure is over. `vi.doUnmock` only — no
    // `vi.resetModules()`, because a real session never gets one either: the
    // next gesture must succeed purely because `plotRecipeApply.ts`'s
    // `_recipeLibs` slot was nulled on the earlier rejection.
    vi.doUnmock("../lib/plotRecipe");
    const id = await useApp.getState().saveAsPlotRecipe("Warm", "d1");
    expect(id).not.toBeNull();
    expect(useApp.getState().plotRecipes).toHaveLength(1);
  });
});
