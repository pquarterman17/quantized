// P1.3 wave 2, Lane B: the plot-recipe STORE slice, apply path, and
// precedence. Exercises the real `useApp` store (not the bare slice
// factory) so save/apply round-trip through the actual `createWindow`/
// `focusWindow`/`withPlotWindowDocument` seams -- the same style
// store/quickPlotTemplates.test.ts uses for `applyQuickPlotTemplate`.
//
// `saveAsPlotRecipe`/`applyPlotRecipe`/`matchingPlotRecipes` are async (they
// lazy-load `lib/plotRecipe.ts`/`lib/plotRecipeMatch.ts` on first use -- see
// store/plotRecipes.ts's module doc's LAZY-LOADED note, the bundle-size-
// budget fix) -- every call below is awaited.

import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, type PlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

// `technique: null` (never `undefined` -- a default parameter would silently
// substitute "xrd.powder" for an explicit `undefined` argument) means "no
// technique metadata", i.e. `techniqueOf` falls back to "generic".
function dataset(id: string, technique: string | null = "xrd.powder", labels = ["2theta", "Intensity", "Ierr"]): Dataset {
  return {
    id,
    name: `${id}.xy`,
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels,
      units: ["deg", "cps", "cps"],
      metadata: technique === null ? {} : { technique },
    },
  };
}

function resetStore(datasets: Dataset[] = [dataset("d1")]) {
  useApp.setState({
    datasets,
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
}

beforeEach(() => resetStore());

/** Create + focus a real plot window bound to `datasetId` via the actual
 *  store actions -- `saveAsPlotRecipe` reads the focused-window facade
 *  (the live singleton `PlotView` fields + that window's own `.document`),
 *  so tests must produce a REAL focused plot window, not a hand-built one. */
function focusPlotWindow(datasetId: string, viewOverrides: Partial<PlotView> = {}): string {
  const view = { ...defaultPlotView(), ...viewOverrides };
  const id = useApp.getState().createWindow(datasetId, view, "Win");
  useApp.getState().focusWindow(id);
  return id;
}

describe("saveAsPlotRecipe", () => {
  it("captures the focused window's mapping + technique -- round trips through the real store", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const before = useApp.getState().history.length;

    const id = await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1");

    expect(id).not.toBeNull();
    const { plotRecipes, history } = useApp.getState();
    expect(plotRecipes).toHaveLength(1);
    expect(history.length).toBe(before + 1); // one undoable history entry
    const recipe = plotRecipes[0];
    expect(recipe.name).toBe("XRD Recipe");
    expect(recipe.technique).toBe("xrd.powder");
    expect(recipe.mapping.yIds).toHaveLength(1);
    expect(recipe.signature.map((e) => e.label)).toContain("2theta");
    expect(recipe.signature.map((e) => e.label)).toContain("Intensity");
  });

  it("never overwrites a same-named recipe -- dedupes the name instead (L0.31)", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    await useApp.getState().saveAsPlotRecipe("Dup", "d1");
    await useApp.getState().saveAsPlotRecipe("Dup", "d1");

    const names = useApp.getState().plotRecipes.map((r) => r.name);
    expect(names).toEqual(["Dup", "Dup (2)"]);
    expect(useApp.getState().plotRecipes[0].id).not.toBe(useApp.getState().plotRecipes[1].id);
  });

  it("fails closed when the dataset does not exist, zero mutation", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const id = await useApp.getState().saveAsPlotRecipe("X", "nope");
    expect(id).toBeNull();
    expect(useApp.getState().plotRecipes).toHaveLength(0);
  });

  it("fails closed when no plot window is focused on the given dataset, zero mutation", async () => {
    // No windows at all (resetStore's default) -- nothing focused.
    const id = await useApp.getState().saveAsPlotRecipe("X", "d1");
    expect(id).toBeNull();
    expect(useApp.getState().plotRecipes).toHaveLength(0);
    expect(useApp.getState().status).toContain("unavailable");
  });

  it("fails closed when the focused window is bound to a DIFFERENT dataset", async () => {
    resetStore([dataset("d1"), dataset("d2")]);
    focusPlotWindow("d2", { xKey: 0, yKeys: [1] });
    const id = await useApp.getState().saveAsPlotRecipe("X", "d1");
    expect(id).toBeNull();
    expect(useApp.getState().plotRecipes).toHaveLength(0);
  });
});

describe("renamePlotRecipe / deletePlotRecipe / duplicatePlotRecipe (+ undo)", () => {
  async function saved(): Promise<string> {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    return (await useApp.getState().saveAsPlotRecipe("Original", "d1"))!;
  }

  it("renames a recipe with ONE undoable history entry", async () => {
    const id = await saved();
    const before = useApp.getState().history.length;
    useApp.getState().renamePlotRecipe(id, "Renamed");
    expect(useApp.getState().plotRecipes.find((r) => r.id === id)?.name).toBe("Renamed");
    expect(useApp.getState().history.length).toBe(before + 1);

    useApp.getState().undo();
    expect(useApp.getState().plotRecipes.find((r) => r.id === id)?.name).toBe("Original");
  });

  it("rename is a no-op for an unknown id or a blank name", async () => {
    const id = await saved();
    const before = useApp.getState().history.length;
    useApp.getState().renamePlotRecipe("nope", "X");
    useApp.getState().renamePlotRecipe(id, "   ");
    expect(useApp.getState().plotRecipes.find((r) => r.id === id)?.name).toBe("Original");
    expect(useApp.getState().history.length).toBe(before);
  });

  it("renaming to an existing name dedupes rather than colliding", async () => {
    const id = await saved(); // "Original"
    await useApp.getState().saveAsPlotRecipe("Taken", "d1");

    useApp.getState().renamePlotRecipe(id, "Taken");

    const names = useApp.getState().plotRecipes.map((r) => r.name);
    expect(names).toEqual(["Taken (2)", "Taken"]);
  });

  it("deletes a recipe and undo restores it", async () => {
    const id = await saved();
    const countBefore = useApp.getState().plotRecipes.length;
    useApp.getState().deletePlotRecipe(id);
    expect(useApp.getState().plotRecipes.find((r) => r.id === id)).toBeUndefined();

    useApp.getState().undo();
    expect(useApp.getState().plotRecipes).toHaveLength(countBefore);
    expect(useApp.getState().plotRecipes.find((r) => r.id === id)).toBeDefined();
  });

  it("delete is a no-op for an unknown id", async () => {
    const before = useApp.getState().history.length;
    useApp.getState().deletePlotRecipe("nope");
    expect(useApp.getState().history.length).toBe(before);
  });

  it("duplicates a recipe under a deduped '<name> copy' name", async () => {
    const id = await saved();
    const newId = useApp.getState().duplicatePlotRecipe(id);
    expect(newId).not.toBeNull();
    expect(newId).not.toBe(id);
    const names = useApp.getState().plotRecipes.map((r) => r.name);
    expect(names).toEqual(["Original", "Original copy"]);

    // A second duplicate of the SAME source must not collide on "Original copy".
    useApp.getState().duplicatePlotRecipe(id);
    expect(useApp.getState().plotRecipes.map((r) => r.name)).toEqual([
      "Original",
      "Original copy",
      "Original copy (2)",
    ]);
  });

  it("duplicate is a no-op (null) for an unknown id", () => {
    expect(useApp.getState().duplicatePlotRecipe("nope")).toBeNull();
  });
});

describe("applyPlotRecipe", () => {
  async function saved(): Promise<string> {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    return (await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1"))!;
  }

  it("clean match: creates a NEW figure via ONE undo entry (undo removes the figure AND the window)", async () => {
    const id = await saved();
    const windowsBefore = useApp.getState().plotWindows.length;
    const figuresBefore = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;

    const ok = await useApp.getState().applyPlotRecipe(id, "d1");

    expect(ok).toBe(true);
    expect(useApp.getState().plotWindows.length).toBe(windowsBefore + 1);
    expect(useApp.getState().editableFigures.length).toBe(figuresBefore + 1);
    expect(useApp.getState().history.length).toBe(historyBefore + 1);
    expect(useApp.getState().pendingRecipeApplication).toBeNull();

    useApp.getState().undo();
    expect(useApp.getState().plotWindows.length).toBe(windowsBefore);
    expect(useApp.getState().editableFigures.length).toBe(figuresBefore);
  });

  it("never mutates plotRecipes itself (apply is not a second save)", async () => {
    const id = await saved();
    const before = useApp.getState().plotRecipes;
    await useApp.getState().applyPlotRecipe(id, "d1");
    expect(useApp.getState().plotRecipes).toBe(before);
  });

  it("refused apply is zero mutation and reports why (technique mismatch)", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const id = (await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1"))!;
    const savedRecipes = useApp.getState().plotRecipes;
    // Swap the SAME dataset id onto a different technique -- resolveRecipe
    // must refuse rather than guess.
    useApp.setState({ datasets: [dataset("d1", "magnetometry.mvsh")], plotRecipes: savedRecipes });
    const figuresBefore = useApp.getState().editableFigures.length;

    const ok = await useApp.getState().applyPlotRecipe(id, "d1");

    expect(ok).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore);
    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().status).toContain("unavailable");
  });

  it("fails closed for an unknown recipe id, zero mutation", async () => {
    const figuresBefore = useApp.getState().editableFigures.length;
    const ok = await useApp.getState().applyPlotRecipe("nope", "d1");
    expect(ok).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore);
    expect(useApp.getState().status).toContain("unavailable");
  });

  it("fails closed for an unknown dataset id, zero mutation", async () => {
    const id = await saved();
    const figuresBefore = useApp.getState().editableFigures.length;
    const ok = await useApp.getState().applyPlotRecipe(id, "nope");
    expect(ok).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore);
  });

  it("unmatched fields stage a pending application (zero mutation) -- confirm applies the resolved subset with ONE undo entry", async () => {
    const id = await saved();
    const savedRecipes = useApp.getState().plotRecipes;
    // Rename the Y column the recipe bound -- X still resolves, Y does not:
    // not a refusal (no technique mismatch / errorRole flip), just unmatched.
    useApp.setState({
      datasets: [dataset("d1", "xrd.powder", ["2theta", "Signal", "Ierr"])],
      plotRecipes: savedRecipes,
    });
    const windowsBefore = useApp.getState().plotWindows.length;
    const figuresBefore = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;

    const ok = await useApp.getState().applyPlotRecipe(id, "d1");

    expect(ok).toBe(false); // not yet applied
    expect(useApp.getState().plotWindows).toHaveLength(windowsBefore);
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore);
    expect(useApp.getState().history).toHaveLength(historyBefore); // no mutation yet
    const pending = useApp.getState().pendingRecipeApplication;
    expect(pending).not.toBeNull();
    expect(pending!.recipe.id).toBe(id);
    expect(pending!.resolution.unmatched.some((m) => m.includes("Intensity"))).toBe(true);

    const confirmed = useApp.getState().confirmPendingRecipeApplication();

    expect(confirmed).toBe(true);
    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().plotWindows).toHaveLength(windowsBefore + 1);
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore + 1);
    expect(useApp.getState().history).toHaveLength(historyBefore + 1); // ONE undo entry total
  });

  it("cancelling a pending application clears it without any mutation", async () => {
    const id = await saved();
    const savedRecipes = useApp.getState().plotRecipes;
    useApp.setState({
      datasets: [dataset("d1", "xrd.powder", ["2theta", "Signal", "Ierr"])],
      plotRecipes: savedRecipes,
    });
    await useApp.getState().applyPlotRecipe(id, "d1");
    expect(useApp.getState().pendingRecipeApplication).not.toBeNull();
    const windowsBefore = useApp.getState().plotWindows.length;
    const historyBefore = useApp.getState().history.length;

    useApp.getState().cancelPendingRecipeApplication();

    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().plotWindows).toHaveLength(windowsBefore);
    expect(useApp.getState().history).toHaveLength(historyBefore);
  });

  it("confirming with nothing pending is a no-op", () => {
    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().confirmPendingRecipeApplication()).toBe(false);
  });
});

describe("matchingPlotRecipes", () => {
  it("orders a clean (zero-unmatched) match before a partial match", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const partialId = (await useApp.getState().saveAsPlotRecipe("Partial-source", "d1"))!;
    // Break this recipe's Y match by renaming the column AFTER capture, then
    // save a SECOND recipe against the renamed (now-current) dataset shape --
    // that one stays a clean match against the live dataset.
    useApp.setState({ datasets: [dataset("d1", "xrd.powder", ["2theta", "Signal", "Ierr"])] });
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const cleanId = (await useApp.getState().saveAsPlotRecipe("Clean-source", "d1"))!;

    const ds = useApp.getState().datasets[0];
    const matches = await useApp.getState().matchingPlotRecipes(ds);

    expect(matches.map((r) => r.id)).toEqual([cleanId, partialId]);
  });

  it("a generic-technique dataset gets no matches", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1");
    const genericDs = dataset("d2", null);

    expect(await useApp.getState().matchingPlotRecipes(genericDs)).toEqual([]);
  });

  it("a recipe scoped to a different technique never matches", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1");
    const otherDs = dataset("d2", "magnetometry.mvsh", ["Field", "Moment"]);

    expect(await useApp.getState().matchingPlotRecipes(otherDs)).toEqual([]);
  });
});
