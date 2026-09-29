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
