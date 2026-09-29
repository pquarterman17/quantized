// F4.2 / audit P1.3: choosing a transformation and a style template when a
// Plot Recipe is applied from the Recipe Manager. Runs the REAL stores and a
// REAL saved transformation recipe (a recorded local "stack" step, the P2.5
// apply path) -- nothing here is mocked, and every assertion reads state.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureRecipe, type PlotRecipe } from "../../../lib/plotRecipe";
import { sanitizeSteps } from "../../../lib/pipeline";
import { defaultPlotView } from "../../../lib/plotview";
import { deriveExpectations } from "../../../lib/recipeExpect";
import { saveTemplate, toTemplate } from "../../../lib/template";
import { runTransform } from "../../../lib/transformRun";
import type { Dataset } from "../../../lib/types";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useApp } from "../../../store/useApp";
import { applyRecipeWithChoices, outlierPolicyNote } from "./recipeManagerActions";

vi.mock("../../../store/toasts", () => ({ toast: vi.fn() }));

const meta = { technique: "xrd.powder" };
const SRC: Dataset = {
  id: "src",
  name: "src.xy",
  data: { time: [0, 1, 2], values: [[1, 5, 10], [2, 6, 20], [3, 7, 30]], labels: ["key", "T", "v"], units: ["", "K", "emu"], metadata: meta },
};
// Same quantities, another column order and other values.
const B: Dataset = {
  id: "b",
  name: "b.xy",
  data: { time: [0, 1], values: [[100, 50, 9], [200, 60, 8]], labels: ["v", "T", "key"], units: ["emu", "K", ""], metadata: meta },
};

const store = () => useApp.getState();
const windowDataset = (w: { document?: { bindings: { datasetId: string | null } } | null }) => w.document?.bindings.datasetId;

beforeEach(() => {
  localStorage.clear();
  useApp.setState({
    datasets: [SRC, B],
    folders: [],
    activeId: "src",
    selectedIds: ["src"],
    macroRecording: true,
    macroSteps: [],
    pipelineRunning: false,
    plotRecipes: [],
    pendingRecipeApplication: null,
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    history: [],
    future: [],
    status: "",
    excludedDisplay: "hide",
  });
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: true });
});

/** Record a local stack on SRC, save it as the transformation recipe
 *  "stacked", and capture a Plot Recipe off the stacked output -- the real
 *  "transform, then plot" workflow a recipe would replay. */
async function transformThenRecipe(): Promise<PlotRecipe> {
  const out = await runTransform(store, { op: "stack", channels: [1, 2] }, "src");
  const steps = sanitizeSteps(JSON.parse(JSON.stringify(store().macroSteps)));
  saveTemplate(toTemplate("stacked", steps, [], { revision: 2, expects: deriveExpectations(steps, SRC) }));
  useApp.setState({ macroRecording: false, history: [] });
  const stacked = store().datasets.find((d) => d.id === out!.id)!;
  const last = stacked.data.labels.length - 1;
  return captureRecipe(stacked, { ...defaultPlotView(), xKey: 0, yKeys: [last], plotTemplate: "nature" }, null, {
    id: "p1",
    name: "Stacked view",
    appVersion: "0",
  });
}

describe("applyRecipeWithChoices", () => {
  it("runs the chosen transformation first, then plots its OUTPUT, never the source", async () => {
    const recipe = await transformThenRecipe();
    const before = store().datasets.map((d) => d.id);

    const ok = await applyRecipeWithChoices(recipe, "b", { transformName: "stacked" });

    expect(ok).toBe(true);
    const created = store().datasets.filter((d) => !before.includes(d.id));
    const output = created.find((d) => d.data.metadata.transform_recipe);
    expect(output).toBeDefined();
    expect(store().plotWindows).toHaveLength(1);
    expect(windowDataset(store().plotWindows[0])).toBe(output!.id);
    expect(store().datasets.find((d) => d.id === "b")!.data).toEqual(B.data);
  });

  it("uses the chosen style template instead of the recipe's own, leaving the saved recipe untouched", async () => {
    const recipe = await transformThenRecipe();
    const stackedId = store().datasets[store().datasets.length - 1].id;

    expect(await applyRecipeWithChoices(recipe, stackedId, { styleTemplate: "poster" })).toBe(true);

    expect(store().plotWindows[0].document?.plot.view.plotTemplate).toBe("poster");
    expect(recipe.visual.plotTemplate).toBe("nature");
  });

  it("keeps the recipe's own style template when none is chosen", async () => {
    const recipe = await transformThenRecipe();
    const stackedId = store().datasets[store().datasets.length - 1].id;
    expect(await applyRecipeWithChoices(recipe, stackedId, {})).toBe(true);
    expect(store().plotWindows[0].document?.plot.view.plotTemplate).toBe("nature");
  });

  it("refuses by name, creating nothing, when the chosen transformation no longer exists", async () => {
    const recipe = await transformThenRecipe();
    const before = store().datasets.length;
    await expect(applyRecipeWithChoices(recipe, "b", { transformName: "deleted since" })).rejects.toThrow(
      /transformation “deleted since” is no longer saved/,
    );
    expect(store().datasets).toHaveLength(before);
    expect(store().plotWindows).toHaveLength(0);
  });

  // F4.2c owner decision (b): "Rejection with notice." The transformation
  // runs, the Plot Recipe refuses its output -> the output is rolled back,
  // the undo/redo stacks are exactly what they were, and the notice names
  // the recipe's own reason.
  it("rolls back the output, restores undo/redo exactly, and names the reason when the recipe refuses it", async () => {
    const recipe = { ...(await transformThenRecipe()), technique: "magnetometry.mvsh" as const };
    store().renameDataset("b", "b renamed");
    store().undo(); // one redo entry to preserve
    store().recordHistory("an earlier edit");
    const ids = store().datasets.map((d) => d.id);
    const activeBefore = store().activeId;
    const historySeqs = store().history.map((e) => e.seq);
    const futureSeqs = store().future.map((e) => e.seq);

    await expect(applyRecipeWithChoices(recipe, "b", { transformName: "stacked" })).rejects.toThrow(
      /saved for magnetometry\.mvsh, not xrd\.powder.*output of transformation “stacked” was removed/,
    );

    expect(store().datasets.map((d) => d.id)).toEqual(ids);
    expect(store().activeId).toBe(activeBefore);
    expect(store().plotWindows).toHaveLength(0);
    expect(store().history.map((e) => e.seq)).toEqual(historySeqs);
    expect(store().future.map((e) => e.seq)).toEqual(futureSeqs);
    expect(store().status).toMatch(/saved for magnetometry\.mvsh, not xrd\.powder/);
    // No entry left anywhere that could bring the removed output back.
    for (const e of [...store().history, ...store().future]) {
      expect(e.snapshot.datasets.some((d) => d.data.metadata.transform_recipe)).toBe(false);
    }
  });

  it("scrubs the removed output from every undo entry when another edit was recorded in between", async () => {
    const recipe = await transformThenRecipe();
    const ids = store().datasets.map((d) => d.id);
    const original = store().applyPlotRecipeObject;
    // An unrelated edit lands between the transformation and the refusal.
    useApp.setState({
      applyPlotRecipeObject: () => {
        store().renameDataset("src", "src renamed");
        useApp.setState({ status: 'Plot Recipe "x" unavailable: refused for the test' });
        return Promise.resolve(false);
      },
    });
    try {
      await expect(applyRecipeWithChoices(recipe, "b", { transformName: "stacked" })).rejects.toThrow(/refused for the test/);
    } finally {
      useApp.setState({ applyPlotRecipeObject: original });
    }

    expect(store().datasets.map((d) => d.id)).toEqual(ids);
    expect(store().history.map((e) => e.label)).toContain("rename dataset");
    for (const e of [...store().history, ...store().future]) {
      expect(e.snapshot.datasets.some((d) => d.data.metadata.transform_recipe)).toBe(false);
    }
    store().undo();
    store().undo();
    expect(store().datasets.some((d) => d.data.metadata.transform_recipe)).toBe(false);
  });

  it("keeps the output when the recipe only stages a preview for it (not a refusal)", async () => {
    const base = await transformThenRecipe();
    const ghost = { ...base.signature[0], id: "ghost", label: "nowhere", aliases: [] };
    const recipe = { ...base, signature: [...base.signature, ghost] };
    const before = store().datasets.map((d) => d.id);

    expect(await applyRecipeWithChoices(recipe, "b", { transformName: "stacked" })).toBe(false);

    const pending = store().pendingRecipeApplication;
    expect(pending).not.toBeNull();
    const output = store().datasets.find((d) => d.id === pending!.datasetId);
    expect(before).not.toContain(output!.id);
    expect(output!.data.metadata.transform_recipe).toBeDefined();
  });

  /** A recipe whose extra field never matches, so applying it stages the preview. */
  async function stagingRecipe(): Promise<PlotRecipe> {
    const base = await transformThenRecipe();
    return { ...base, signature: [...base.signature, { ...base.signature[0], id: "ghost", label: "nowhere", aliases: [] }] };
  }

  it("rolls the output back, restoring undo/redo exactly, when the staged preview is cancelled", async () => {
    const recipe = await stagingRecipe();
    store().renameDataset("b", "b renamed");
    store().undo(); // one redo entry to preserve
    const ids = store().datasets.map((d) => d.id);
    const activeBefore = store().activeId;
    const historySeqs = store().history.map((e) => e.seq);
    const futureSeqs = store().future.map((e) => e.seq);

    expect(await applyRecipeWithChoices(recipe, "b", { transformName: "stacked" })).toBe(false);
    expect(store().datasets.length).toBeGreaterThan(ids.length);
    store().cancelPendingRecipeApplication();

    expect(store().pendingRecipeApplication).toBeNull();
    expect(store().datasets.map((d) => d.id)).toEqual(ids);
    expect(store().activeId).toBe(activeBefore);
    expect(store().history.map((e) => e.seq)).toEqual(historySeqs);
    expect(store().future.map((e) => e.seq)).toEqual(futureSeqs);
    expect(store().status).toBe(
      "Plot Recipe “Stacked view” preview cancelled — the output of transformation “stacked” was removed.",
    );
  });

  it("still rolls back when the preview was re-staged by a confirm and then cancelled", async () => {
    const recipe = await stagingRecipe();
    const ids = store().datasets.map((d) => d.id);
    await applyRecipeWithChoices(recipe, "b", { transformName: "stacked" });

    expect(await store().confirmPendingRecipeApplication()).toBe(false); // same unmatched field -> re-staged
    expect(store().pendingRecipeApplication).not.toBeNull();
    store().cancelPendingRecipeApplication();

    expect(store().datasets.map((d) => d.id)).toEqual(ids);
  });

  it("keeps the output, plotted, when the staged preview is confirmed", async () => {
    const recipe = await stagingRecipe();
    await applyRecipeWithChoices(recipe, "b", { transformName: "stacked" });
    const outputId = store().pendingRecipeApplication!.datasetId;

    expect(await store().confirmPendingRecipeApplicationPartial()).toBe(true);

    expect(store().datasets.some((d) => d.id === outputId)).toBe(true);
    expect(store().plotWindows).toHaveLength(1);
    expect(windowDataset(store().plotWindows[0])).toBe(outputId);
    store().cancelPendingRecipeApplication(); // nothing pending: a no-op, never a late take-back
    expect(store().datasets.some((d) => d.id === outputId)).toBe(true);
  });

  it("rolls the output back if applying the Plot Recipe throws after the transformation ran", async () => {
    const recipe = await transformThenRecipe();
    const ids = store().datasets.map((d) => d.id);
    const original = store().applyPlotRecipeObject;
    useApp.setState({ applyPlotRecipeObject: () => Promise.reject(new Error("chunk failed")) });
    try {
      await expect(applyRecipeWithChoices(recipe, "b", { transformName: "stacked" })).rejects.toThrow(/chunk failed/);
    } finally {
      useApp.setState({ applyPlotRecipeObject: original });
    }

    expect(store().datasets.map((d) => d.id)).toEqual(ids);
    expect(store().history).toHaveLength(0);
  });

  it("reports the recipe's excluded-row policy when it differs from the preference, without changing it", async () => {
    const recipe = { ...(await transformThenRecipe()), outlierPolicy: { excludedDisplay: "grey" as const } };
    const stackedId = store().datasets[store().datasets.length - 1].id;

    expect(await applyRecipeWithChoices(recipe, stackedId, {})).toBe(true);

    expect(store().status).toMatch(/saved with excluded rows greyed/);
    expect(store().excludedDisplay).toBe("hide");
  });
});

describe("outlierPolicyNote", () => {
  it("is empty when the policy matches or was never recorded", () => {
    expect(outlierPolicyNote({ excludedDisplay: "hide" }, "hide")).toBe("");
    expect(outlierPolicyNote(null, "grey")).toBe("");
  });

  it("names both the recipe's policy and the current preference when they differ", () => {
    expect(outlierPolicyNote({ excludedDisplay: "hide" }, "grey")).toBe(
      "it was saved with excluded rows hidden; Preferences › Excluded rows is set to Grey",
    );
  });
});
