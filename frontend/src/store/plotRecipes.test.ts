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

import { beforeEach, describe, expect, it, vi } from "vitest";

import { facetPanelsOf } from "../lib/composition";
import { facetCompositionFromBinding } from "../lib/facet";
import { captureRecipe, type PlotRecipe } from "../lib/plotRecipe";
import { defaultPlotView, type PlotView } from "../lib/plotview";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import type { Dataset } from "../lib/types";
import { useGlobalPlotRecipes } from "./globalPlotRecipes";
import { metaFor } from "../lib/recipeIndex";
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
    facetKey: null,
    history: [],
    future: [],
    status: "",
  });
  // Finding 4: matchingPlotRecipes/cleanMatchingPlotRecipe now read the
  // GLOBAL store too -- reset it alongside the project one so no test leaks
  // state into another via localStorage/module-level state.
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: true });
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

// ORCHESTRATOR RULING B (code-review findings 2+3): the project-scope half
// of the copy-with-a-fresh-id cross-scope transfer primitive (the
// store/globalPlotRecipes.ts `copyIn` sibling). Undo of a copy-to-project
// must remove ONLY the tracked copy -- never touch whatever it came from
// (an external recipe object, e.g. from the global scope, that this action
// never mutates).
describe("copyPlotRecipeIn", () => {
  it("adds the external recipe under a FRESH id with ONE undoable history entry", async () => {
    const external: PlotRecipe = {
      ...(await (async () => {
        focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
        const id = (await useApp.getState().saveAsPlotRecipe("External", "d1"))!;
        const r = useApp.getState().plotRecipes.find((x) => x.id === id)!;
        useApp.setState({ plotRecipes: [] }); // it was never really in the project list
        return r;
      })()),
      id: "external-fixed-id",
    };
    const before = useApp.getState().history.length;

    const newId = useApp.getState().copyPlotRecipeIn(external);

    expect(newId).not.toBe("external-fixed-id"); // fresh id, never the source's own
    expect(useApp.getState().plotRecipes.map((r) => r.name)).toEqual(["External"]);
    expect(useApp.getState().history.length).toBe(before + 1);
  });

  it("dedupes the name against the project list", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    await useApp.getState().saveAsPlotRecipe("Taken", "d1");
    const external: PlotRecipe = { ...useApp.getState().plotRecipes[0], id: "other-id", name: "Taken" };

    useApp.getState().copyPlotRecipeIn(external);

    expect(useApp.getState().plotRecipes.map((r) => r.name)).toEqual(["Taken", "Taken (2)"]);
  });

  // Finding 2's exact bug, now closed by construction: undoing the
  // project-side add must NEVER remove/affect the source the copy came
  // from (here simulated as a recipe that lives ONLY in this test's local
  // variable, standing in for "the global original") -- there is nothing
  // else for undo to touch.
  it("undo after a copy-to-project removes ONLY the tracked copy, leaving nothing else behind", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const globalOriginal: PlotRecipe = {
      ...(await (async () => {
        const id = (await useApp.getState().saveAsPlotRecipe("From Global", "d1"))!;
        const r = useApp.getState().plotRecipes.find((x) => x.id === id)!;
        useApp.setState({ plotRecipes: [] });
        return r;
      })()),
      id: "global-original-id",
    };
    const countBefore = useApp.getState().plotRecipes.length;

    useApp.getState().copyPlotRecipeIn(globalOriginal);
    expect(useApp.getState().plotRecipes).toHaveLength(countBefore + 1);

    useApp.getState().undo();

    expect(useApp.getState().plotRecipes).toHaveLength(countBefore);
    // The "source" object itself is untouched -- copyPlotRecipeIn never
    // mutates its argument.
    expect(globalOriginal.id).toBe("global-original-id");
    expect(globalOriginal.name).toBe("From Global");
  });
});

describe("applyPlotRecipe", () => {
  async function saved(): Promise<string> {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    return (await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1"))!;
  }

  it("records a use on a clean apply, with the scope it actually lives in (P3.5)", async () => {
    const id = await saved();
    await useApp.getState().applyPlotRecipe(id, "d1");
    // `applyResolvedRecipe` is the one commit seam every apply route funnels
    // through, and it reaches the sidecar via a dynamic import to keep it out
    // of the eager bundle — hence the wait.
    await vi.waitFor(() => expect(metaFor({ kind: "plot", scope: "project", id }).useCount).toBe(1));
    // A recipe saved into the project must not be recorded as a global one:
    // the two are different rows in the Library and different sidecar keys.
    expect(metaFor({ kind: "plot", scope: "global", id }).useCount).toBe(0);
  });

  it("records NOTHING when the apply only STAGES a pending application", async () => {
    // Staging mutates nothing and waits for a confirm the user may cancel, so
    // counting it would put never-applied recipes in "recently used".
    //
    // The negative is proved by ORDERING, not by waiting a fixed number of
    // microtasks: the recorder reaches the sidecar through a dynamic import,
    // so `useCount === 0` shortly after the call passes just as well when the
    // write is merely late. A second, definitely-recording apply is awaited
    // first; both go through the same resolved module in order.
    const id = await saved();
    const original = useApp.getState().datasets[0];
    useApp.setState({
      datasets: [{ ...original, data: { ...original.data, labels: ["totally", "different"] } }],
    });
    await useApp.getState().applyPlotRecipe(id, "d1");
    expect(useApp.getState().editableFigures).toHaveLength(0); // nothing was applied

    useApp.setState({ datasets: [original] });
    const witness = await saved();
    await useApp.getState().applyPlotRecipe(witness, "d1");
    await vi.waitFor(() =>
      expect(metaFor({ kind: "plot", scope: "project", id: witness }).useCount).toBe(1),
    );
    expect(metaFor({ kind: "plot", scope: "project", id }).useCount).toBe(0);
  });

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

  // FINDING 4 (final code-review round): matchingPlotRecipes/
  // cleanMatchingPlotRecipe already span BOTH scopes -- applyPlotRecipe(id)
  // looking ONLY at the project list means the advertised pair ("here's a
  // matching recipe" / "apply it by id") doesn't compose for a global result.
  it("applies a GLOBAL-only recipe by id -- the project-list miss falls back to the hydrated global list", async () => {
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const globalOnly = captureRecipe(dataset("d1"), view, null, {
      id: "global-only-id",
      name: "Global Recipe",
      appVersion: "0",
    });
    useGlobalPlotRecipes.setState({ recipes: [globalOnly], hydrated: true });
    const figuresBefore = useApp.getState().editableFigures.length;

    const ok = await useApp.getState().applyPlotRecipe("global-only-id", "d1");

    expect(ok).toBe(true);
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore + 1);
    expect(useApp.getState().plotRecipes).toHaveLength(0); // never copied into the project list
  });

  it("unmatched fields stage a pending application (zero mutation)", async () => {
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
  });

  // ORCHESTRATOR RULING A (code-review finding 1): confirm must not trust
  // the staged resolution as-is -- it RE-RESOLVES against the CURRENT
  // dataset. Since nothing changes the dataset further here, the fresh
  // resolve reproduces the IDENTICAL unmatched set, so confirm re-stages
  // rather than silently applying with the field dropped (zero mutation
  // either way) -- but the status must NOT falsely claim "the dataset
  // changed" when it demonstrably didn't (the old wording's bug: this exact
  // scenario is the dialog's own normal case, since the dialog only opens
  // with unmatched > 0 and blocks dataset edits while up, so EVERY re-resolve
  // from there reproduces the identical set). It should say the fields are
  // still unmatched instead.
  it("confirming with the IDENTICAL unmatched set re-resolves and RE-STAGES, zero mutation, without claiming the dataset changed", async () => {
    const id = await saved();
    const savedRecipes = useApp.getState().plotRecipes;
    useApp.setState({
      datasets: [dataset("d1", "xrd.powder", ["2theta", "Signal", "Ierr"])],
      plotRecipes: savedRecipes,
    });
    await useApp.getState().applyPlotRecipe(id, "d1");
    const stagedPending = useApp.getState().pendingRecipeApplication;
    expect(stagedPending).not.toBeNull();
    const windowsBefore = useApp.getState().plotWindows.length;
    const figuresBefore = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;

    const confirmed = await useApp.getState().confirmPendingRecipeApplication();

    expect(confirmed).toBe(false);
    expect(useApp.getState().plotWindows).toHaveLength(windowsBefore); // zero mutation
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore);
    expect(useApp.getState().history).toHaveLength(historyBefore);
    const restaged = useApp.getState().pendingRecipeApplication;
    expect(restaged).not.toBeNull(); // re-staged, not cleared
    expect(restaged!.resolution.unmatched.some((m) => m.includes("Intensity"))).toBe(true);
    expect(useApp.getState().status).not.toContain("dataset changed");
    expect(useApp.getState().status).toContain("still unmatched");
  });

  // The other half of the same fix: when the fresh unmatched set DOES differ
  // from the staged one (a real edit landed between stage and confirm, even
  // though it didn't fully resolve the match), the "dataset changed" wording
  // is correct and stays.
  it("confirming with a DIFFERENT (still non-empty) unmatched set keeps the 'dataset changed' wording", async () => {
    // A bespoke 4-column fixture (two Y series, each its own signature
    // entry) rather than the shared 3-column `dataset()` helper -- this test
    // needs a SECOND independently-breakable field.
    const fourCol = (labels: string[]): Dataset => ({
      id: "d1",
      name: "d1.xy",
      data: {
        time: [0, 1, 2],
        values: [[10, 100, 5, 1], [20, 200, 6, 2], [30, 300, 7, 3]],
        labels,
        units: ["deg", "cps", "cps", "cps"],
        metadata: { technique: "xrd.powder" },
      },
    });
    useApp.setState({ datasets: [fourCol(["2theta", "Intensity", "Extra", "Ierr"])] });
    focusPlotWindow("d1", { xKey: 0, yKeys: [1, 2] });
    const id = (await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1"))!;
    const savedRecipes = useApp.getState().plotRecipes;
    // Stage: only Y ("Intensity") unmatched -- "Extra" is still present and
    // correctly named, so it resolves fine.
    useApp.setState({
      datasets: [fourCol(["2theta", "Signal", "Extra", "Ierr"])],
      plotRecipes: savedRecipes,
    });
    await useApp.getState().applyPlotRecipe(id, "d1");
    const staged = useApp.getState().pendingRecipeApplication!;
    expect(staged.resolution.unmatched).toHaveLength(1);

    // Between stage and confirm, "Extra" ALSO goes missing -- the FRESH
    // unmatched set now has TWO entries, not the staged ONE.
    useApp.setState({ datasets: [fourCol(["2theta", "Signal", "Other", "Ierr"])] });

    const confirmed = await useApp.getState().confirmPendingRecipeApplication();

    expect(confirmed).toBe(false);
    const restaged = useApp.getState().pendingRecipeApplication!;
    expect(restaged.resolution.unmatched.length).toBeGreaterThan(1);
    expect(useApp.getState().status).toContain("dataset changed");
  });

  // Finding 4's core bug: a STALE staged resolution's column indices go
  // wrong when the dataset is edited between stage and confirm. Fixed by
  // re-resolving at confirm time and applying only the FRESH mapping.
  it("confirming after a REAL store action fixes the match re-resolves cleanly and applies the FRESH (not stale) mapping", async () => {
    const id = await saved(); // recipe captures Y = "Intensity" at index 1
    const savedRecipes = useApp.getState().plotRecipes;
    useApp.setState({
      datasets: [dataset("d1", "xrd.powder", ["2theta", "Signal", "Ierr"])],
      plotRecipes: savedRecipes,
    });
    await useApp.getState().applyPlotRecipe(id, "d1"); // stages: Y unmatched
    expect(useApp.getState().pendingRecipeApplication).not.toBeNull();

    // Two REAL store actions mutate the dataset's columns AGAIN between
    // stage and confirm -- reintroducing an "Intensity"-labeled column with
    // the recipe's originally-captured unit ("cps"), but at a NEW index (3,
    // not the recipe's originally-captured 1). Each pushes its own history
    // entry, so the "ONE undo entry" count below is taken from AFTER these,
    // isolating just the confirm gesture's own entry.
    const ok = useApp.getState().addFormula("d1", "Intensity", "A * 2");
    expect(ok).toBe(true);
    useApp.getState().updateFormula("d1", 0, { unit: "cps" });

    const windowsBefore = useApp.getState().plotWindows.length;
    const figuresBefore = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;

    const confirmed = await useApp.getState().confirmPendingRecipeApplication();

    expect(confirmed).toBe(true);
    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().plotWindows).toHaveLength(windowsBefore + 1);
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore + 1);
    expect(useApp.getState().history).toHaveLength(historyBefore + 1); // ONE undo entry (the confirm gesture itself)
    // The applied figure binds the FRESH index (3, the new formula column),
    // never the stale index (1, "Signal" -- the wrong data) captured at
    // stage time.
    expect(useApp.getState().datasets.find((d) => d.id === "d1")?.data.labels[3]).toBe("Intensity");
    expect(useApp.getState().yKeys).toEqual([3]);
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

  it("confirming with nothing pending is a no-op with a status message", async () => {
    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(await useApp.getState().confirmPendingRecipeApplication()).toBe(false);
    expect(useApp.getState().status).toContain("No pending");
  });
});

// P1.3 wave 3, Lane D: the explicit "apply anyway, drop unmatched" opt-in
// (booked in PR #204). Same re-resolve staleness guard as
// confirmPendingRecipeApplication -- the tests below deliberately mirror
// that describe block's setup so the ONE divergence (apply-anyway vs.
// re-stage) is the only thing under test.
describe("confirmPendingRecipeApplicationPartial", () => {
  async function stagedWithUnmatched(): Promise<string> {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const id = (await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1"))!;
    const savedRecipes = useApp.getState().plotRecipes;
    useApp.setState({
      datasets: [dataset("d1", "xrd.powder", ["2theta", "Signal", "Ierr"])],
      plotRecipes: savedRecipes,
    });
    await useApp.getState().applyPlotRecipe(id, "d1");
    return id;
  }

  it("nothing pending is a no-op with a status message", async () => {
    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(await useApp.getState().confirmPendingRecipeApplicationPartial()).toBe(false);
    expect(useApp.getState().status).toContain("No pending");
  });

  it("applies the FRESH resolution's resolved subset even though unmatched is still non-empty, naming the dropped count", async () => {
    await stagedWithUnmatched();
    expect(useApp.getState().pendingRecipeApplication).not.toBeNull();
    const windowsBefore = useApp.getState().plotWindows.length;
    const figuresBefore = useApp.getState().editableFigures.length;
    const historyBefore = useApp.getState().history.length;

    const ok = await useApp.getState().confirmPendingRecipeApplicationPartial();

    expect(ok).toBe(true);
    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().plotWindows).toHaveLength(windowsBefore + 1);
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore + 1);
    expect(useApp.getState().history).toHaveLength(historyBefore + 1); // ONE undo entry
    expect(useApp.getState().status).toContain("dropped 1 unmatched field");
  });

  it("re-resolves at confirm time -- a dataset fixed since staging applies cleanly with no 'dropped' wording", async () => {
    await stagedWithUnmatched();
    expect(useApp.getState().pendingRecipeApplication).not.toBeNull();
    // Fix the mismatch: reintroduce the recipe's expected "Intensity" label.
    useApp.setState({ datasets: [dataset("d1", "xrd.powder", ["2theta", "Intensity", "Ierr"])] });

    const ok = await useApp.getState().confirmPendingRecipeApplicationPartial();

    expect(ok).toBe(true);
    expect(useApp.getState().status).not.toContain("dropped");
    expect(useApp.getState().status).toContain("applied plot recipe");
  });

  it("dataset vanished: pending cleared, zero mutation, status names it", async () => {
    await stagedWithUnmatched();
    useApp.setState({ datasets: [] });
    const figuresBefore = useApp.getState().editableFigures.length;

    const ok = await useApp.getState().confirmPendingRecipeApplicationPartial();

    expect(ok).toBe(false);
    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore);
    expect(useApp.getState().status).toContain("unavailable");
  });

  it("a fresh refusal (technique mismatch) still fails closed -- 'apply anyway' waives unmatched, never a refusal", async () => {
    await stagedWithUnmatched();
    const savedRecipes = useApp.getState().plotRecipes;
    useApp.setState({ datasets: [dataset("d1", "magnetometry.mvsh")], plotRecipes: savedRecipes });
    const figuresBefore = useApp.getState().editableFigures.length;

    const ok = await useApp.getState().confirmPendingRecipeApplicationPartial();

    expect(ok).toBe(false);
    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore);
    expect(useApp.getState().status).toContain("unavailable");
  });
});

describe("applyPlotRecipeObject", () => {
  it("applies a recipe object that is NOT a member of state.plotRecipes (the global-scope seam)", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const id = (await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1"))!;
    const recipe = useApp.getState().plotRecipes.find((r) => r.id === id)!;
    // Remove it from the project list -- applyPlotRecipeObject must not
    // depend on the recipe being findable there.
    useApp.setState({ plotRecipes: [] });
    const windowsBefore = useApp.getState().plotWindows.length;
    const figuresBefore = useApp.getState().editableFigures.length;

    const ok = await useApp.getState().applyPlotRecipeObject(recipe, "d1");

    expect(ok).toBe(true);
    expect(useApp.getState().plotWindows).toHaveLength(windowsBefore + 1);
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore + 1);
    expect(useApp.getState().plotRecipes).toHaveLength(0); // never re-added to the project list
  });

  it("stages a pending application for an unmatched object recipe, same as applyPlotRecipe", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const id = (await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1"))!;
    const recipe = useApp.getState().plotRecipes.find((r) => r.id === id)!;
    useApp.setState({ datasets: [dataset("d1", "xrd.powder", ["2theta", "Signal", "Ierr"])], plotRecipes: [] });

    const ok = await useApp.getState().applyPlotRecipeObject(recipe, "d1");

    expect(ok).toBe(false);
    expect(useApp.getState().pendingRecipeApplication?.recipe.id).toBe(id);
  });
});

describe("cleanMatchingPlotRecipe", () => {
  it("returns the clean match when one exists", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const cleanId = (await useApp.getState().saveAsPlotRecipe("Clean", "d1"))!;

    const found = await useApp.getState().cleanMatchingPlotRecipe(useApp.getState().datasets[0]);

    expect(found?.id).toBe(cleanId);
  });

  it("returns null when only a partial match exists (never offers a partial one)", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    await useApp.getState().saveAsPlotRecipe("Partial-source", "d1");
    // Break the Y match after capture -- only a partial match remains.
    useApp.setState({ datasets: [dataset("d1", "xrd.powder", ["2theta", "Signal", "Ierr"])], plotRecipes: useApp.getState().plotRecipes });

    const found = await useApp.getState().cleanMatchingPlotRecipe(useApp.getState().datasets[0]);

    expect(found).toBeNull();
  });

  it("returns null for a generic-technique dataset", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1");
    const genericDs = dataset("d2", null);

    expect(await useApp.getState().cleanMatchingPlotRecipe(genericDs)).toBeNull();
  });

  // FINDING 4 (code-review): matches must include GLOBAL-scope recipes too,
  // not just the project list -- a global-only recipe should fire the same
  // suggestion just as a project one would.
  it("returns a GLOBAL-scope recipe when it cleanly matches and the project has none", async () => {
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const globalOnly = captureRecipe(dataset("seed"), view, null, { id: "g1", name: "Global Recipe", appVersion: "0" });
    useGlobalPlotRecipes.getState().setAll([globalOnly]);

    const found = await useApp.getState().cleanMatchingPlotRecipe(useApp.getState().datasets[0]);

    expect(found?.id).toBe("g1");
  });

  // FINDING 4's collision rule: legacy data could (in principle) leave the
  // same id in both scopes -- project wins.
  it("prefers the PROJECT entry when both scopes hold an entry under the SAME id", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const id = (await useApp.getState().saveAsPlotRecipe("Project Version", "d1"))!;
    const projectRecipe = useApp.getState().plotRecipes.find((r) => r.id === id)!;
    useGlobalPlotRecipes.getState().setAll([{ ...projectRecipe, name: "Global Version" }]); // SAME id

    const found = await useApp.getState().cleanMatchingPlotRecipe(useApp.getState().datasets[0]);

    expect(found?.name).toBe("Project Version");
  });
});

describe("matchingPlotRecipes", () => {
  // FINDING 4 (code-review): global-scope candidates are merged in,
  // clean-first across BOTH scopes together (not scope-by-scope).
  it("includes GLOBAL-scope recipes alongside project ones, clean matches first across both scopes", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const partialId = (await useApp.getState().saveAsPlotRecipe("Partial-source", "d1"))!;
    useApp.setState({ datasets: [dataset("d1", "xrd.powder", ["2theta", "Signal", "Ierr"])] });
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const globalClean = captureRecipe(useApp.getState().datasets[0], view, null, {
      id: "g1",
      name: "Global Clean",
      appVersion: "0",
    });
    useGlobalPlotRecipes.getState().setAll([globalClean]);

    const matches = await useApp.getState().matchingPlotRecipes(useApp.getState().datasets[0]);

    expect(matches.map((r) => r.id)).toEqual(["g1", partialId]);
  });
});

describe("matchingPlotRecipes — technique gating", () => {
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

// P1.3 wave-2 integration (finding 1): `plotRecipes` was ALREADY serialized
// by the whole-state-spread save path (workspaceIO.ts / useWorkspaceAutosave.ts
// both do `serializeWorkspace({ ...s, ... })`) but `loadWorkspace` never
// restored it -- a load silently dropped every saved recipe, and worse, left
// the PREVIOUS project's live list in place (a cross-project leak). Exercises
// the REAL `serializeWorkspace`/`parseWorkspace` pair, not a hand-built
// WorkspaceState object, so a future .dwk-shape change can't silently stop
// covering this.
describe("loadWorkspace restores plotRecipes (finding 1)", () => {
  it("round-trips a saved recipe through the real serialize path", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1");
    const s = useApp.getState();
    const text = serializeWorkspace({ ...s, plotWindows: s.windowsForSave() });

    // A different project's live list must not survive the load.
    resetStore([dataset("other")]);
    useApp.setState({ plotRecipes: [{ id: "stale-from-other-project" } as unknown as PlotRecipe] });

    const loaded = parseWorkspace(text);
    useApp.getState().loadWorkspace(loaded);

    const restored = useApp.getState().plotRecipes;
    expect(restored).toHaveLength(1);
    expect(restored[0].name).toBe("XRD Recipe");
    expect(restored.map((r) => r.id)).not.toContain("stale-from-other-project");
  });

  it("loading a doc WITHOUT the field clears any live list to [] (no cross-project leak)", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    await useApp.getState().saveAsPlotRecipe("Leftover", "d1");
    expect(useApp.getState().plotRecipes).toHaveLength(1);

    // A legacy/pre-P1.3 doc has no `plotRecipes` field at all.
    useApp.getState().loadWorkspace({ datasets: [] });

    expect(useApp.getState().plotRecipes).toEqual([]);
  });

  it("load-then-serialize round-trips the recipes (erase-on-resave guard)", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1");
    const s1 = useApp.getState();
    const text = serializeWorkspace({ ...s1, plotWindows: s1.windowsForSave() });
    const loaded = parseWorkspace(text);

    useApp.getState().loadWorkspace(loaded);

    // Re-serializing the just-loaded state must NOT erase the recipe --
    // this is the exact "half-wired: saves persist it, load never restores
    // it, so a resave wipes it" destructive path the finding calls out.
    const s2 = useApp.getState();
    const resavedText = serializeWorkspace({ ...s2, plotWindows: s2.windowsForSave() });
    const reparsed = parseWorkspace(resavedText);
    expect(reparsed.plotRecipes).toHaveLength(1);
    expect(reparsed.plotRecipes[0].name).toBe("XRD Recipe");
  });
});

// Finding 3: `pendingRecipeApplication` is transient UI state (like
// `separatePreview`/`quickFigureBuilderDatasetId`) -- a fresh load must never
// resume mid-gesture, especially into a DIFFERENT project where the staged
// dataset id could coincidentally collide with an unrelated dataset.
describe("loadWorkspace clears pendingRecipeApplication (finding 3)", () => {
  it("clears a staged pending application on load; confirming afterward is a no-op with a status message", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const id = (await useApp.getState().saveAsPlotRecipe("XRD Recipe", "d1"))!;
    const savedRecipes = useApp.getState().plotRecipes;
    // Break the Y match so applyPlotRecipe stages a pending application.
    useApp.setState({
      datasets: [dataset("d1", "xrd.powder", ["2theta", "Signal", "Ierr"])],
      plotRecipes: savedRecipes,
    });
    await useApp.getState().applyPlotRecipe(id, "d1");
    expect(useApp.getState().pendingRecipeApplication).not.toBeNull();

    useApp.getState().loadWorkspace({ datasets: [dataset("d9")] });

    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    const figuresBefore = useApp.getState().editableFigures.length;
    const confirmed = await useApp.getState().confirmPendingRecipeApplication();
    expect(confirmed).toBe(false);
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore); // zero mutation
  });
});

// FIGURE_AUTHORING_WORKFLOW_PLAN F4.4: closes `store/plotRecipes.ts`'s own
// documented GAP for the facet case -- a recipe captured from a live facet
// arrangement must rebuild a live facet grid on the TARGET dataset, re-keyed
// by label like every other binding, once the new figure is focused.
describe("applyPlotRecipe rebuilds a live facet composition (F4.4)", () => {
  it("re-keys facetKey onto the target dataset and the focused facade can rebuild the grid", async () => {
    // "2theta" has 3 distinct values (10/20/30) -- a valid facet column.
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    useApp.getState().facetByColumn("d1", 0);
    expect(useApp.getState().facetKey).toBe(0); // sanity: the live gesture set it

    const id = (await useApp.getState().saveAsPlotRecipe("Faceted XRD", "d1"))!;
    const savedRecipes = useApp.getState().plotRecipes;

    // A second dataset, same technique/labels/units -- resolveRecipe re-keys
    // BY LABEL (never by index), same as every other binding; the reordered-
    // columns acceptance case is already covered elsewhere in this suite for
    // xKey/yKeys/errors, so this test's own job is proving the FACET half of
    // that same re-key path actually reaches a live composition.
    const d2: Dataset = dataset("d2");
    useApp.setState({ datasets: [dataset("d1"), d2], plotRecipes: savedRecipes });

    const ok = await useApp.getState().applyPlotRecipe(id, "d2");

    expect(ok).toBe(true);
    const s = useApp.getState();
    expect(s.activeId).toBe("d2");
    expect(s.facetKey).toBe(0); // "2theta" is column 0 on d2 too
    const focused = s.plotWindows.find((w) => w.id === s.focusedWindowId);
    expect(focused?.kind === "plot" ? focused.document?.bindings.facetKey : null).toBe(0);

    // The render-layer fallback (`MultiPanelStage.tsx`) rebuilds the SAME
    // live grid from exactly these hydrated fields -- prove it end to end.
    const rebuilt = facetCompositionFromBinding(d2, s.facetKey, s.xKey, s.yKeys);
    expect(facetPanelsOf(rebuilt)).toHaveLength(3);
  });

  it("still narrows scope honestly: compositionKind is captured but this module never rebuilds panels itself", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    useApp.getState().facetByColumn("d1", 0);
    const id = (await useApp.getState().saveAsPlotRecipe("Faceted XRD", "d1"))!;
    const recipe = useApp.getState().plotRecipes.find((r) => r.id === id)!;
    expect(recipe.visual.compositionKind).toBe("facet");
  });
});
