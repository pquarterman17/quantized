// Q6 (c): a plot recipe saved from a COMPOSITE panel window (the Library's
// "Panel: side by side / stacked / grid" quick picks, `kind: "panel"`)
// captures the window by NAME -- the datasets' names + the layout -- and
// applying it opens a new composite window, with a missing dataset named
// for the apply dialog's existing rebind picker. Real `useApp` store end to
// end, the same style plotRecipesSpatial.test.ts uses.

import { beforeEach, describe, expect, it } from "vitest";

import { parseRecipe, sanitizeRecipes } from "../lib/plotRecipeIO";
import { serializeRecipe } from "../lib/plotRecipe";
import type { Dataset } from "../lib/types";
import { useGlobalPlotRecipes } from "./globalPlotRecipes";
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

function resetStore(datasets: Dataset[]) {
  useApp.setState({
    datasets,
    activeId: null,
    selectedIds: [],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    plotRecipes: [],
    pendingRecipeApplication: null,
    composition: null,
    facetKey: null,
    mapViews: {},
    history: [],
    future: [],
    status: "",
  });
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: true });
}

/** Save a recipe from a live "Panel: side by side" window over d1, d2, d3. */
async function saveTrio(): Promise<string> {
  resetStore([dataset("d1"), dataset("d2"), dataset("d3")]);
  const win = useApp.getState().createPanelWindow(["d1", "d2", "d3"], "row");
  const id = await useApp.getState().saveAsPlotRecipe("Trio", "d1", win);
  expect(id).not.toBeNull();
  return id!;
}

const panelWindows = () => useApp.getState().plotWindows.filter((w) => w.kind === "panel");

beforeEach(() => resetStore([dataset("d1")]));

describe("saveAsPlotRecipe from a composite panel window", () => {
  it("captures the window's datasets by name (the source as null) and its layout", async () => {
    await saveTrio();
    const [recipe] = useApp.getState().plotRecipes;
    expect(recipe.panelWindow).toEqual({ datasets: [null, "d2.xy", "d3.xy"], layout: "row" });
    expect(recipe.panels).toBeNull();
    expect(recipe.technique).toBe("xrd.powder");
  });

  it("fails closed when the dataset is not one of the window's panels", async () => {
    resetStore([dataset("d1"), dataset("d2"), dataset("d9")]);
    const win = useApp.getState().createPanelWindow(["d1", "d2"], "column");
    expect(await useApp.getState().saveAsPlotRecipe("X", "d9", win)).toBeNull();
    expect(useApp.getState().plotRecipes).toHaveLength(0);
    expect(useApp.getState().status).toContain("unavailable");
  });

  it("survives the export/import and workspace boundaries; a v3 recipe without it still loads", async () => {
    await saveTrio();
    const [recipe] = useApp.getState().plotRecipes;
    expect(recipe.panelWindow).toBeDefined();
    expect(parseRecipe(serializeRecipe(recipe)).panelWindow).toEqual(recipe.panelWindow);
    expect(sanitizeRecipes([recipe])[0].panelWindow).toEqual(recipe.panelWindow);
    const [plain] = sanitizeRecipes([{ ...recipe, panelWindow: undefined }]);
    expect(plain.panelWindow).toBeUndefined();
    const [bad] = sanitizeRecipes([{ ...recipe, panelWindow: { datasets: [42], layout: "spiral" } }]);
    expect(bad.panelWindow).toBeUndefined();
  });
});

describe("applying a captured composite panel window", () => {
  it("round-trips: opens a new panel window with the target in the source's slot and siblings by name", async () => {
    const id = await saveTrio();
    const saved = useApp.getState().plotRecipes;
    useApp.setState({ datasets: [dataset("d1"), dataset("d2"), dataset("d3"), dataset("d4")], plotWindows: [], plotRecipes: saved });

    expect(await useApp.getState().applyPlotRecipe(id, "d4")).toBe(true);

    const wins = panelWindows();
    expect(wins).toHaveLength(1);
    expect(wins[0].panel).toEqual({ datasetIds: ["d4", "d2", "d3"], layout: "row" });
    expect(useApp.getState().status).toContain('applied plot recipe "Trio"');
    expect(useApp.getState().editableFigures).toHaveLength(0); // no stray single-plot figure
  });

  it("installs the recorded map view on the target, as a plot-window recipe does", async () => {
    resetStore([dataset("d1"), dataset("d2")]);
    useApp.setState({ mapViews: { d1: { colormap: "magma", logZ: true, colorLimits: [1, 100], slices: [], annotations: [] } } });
    const win = useApp.getState().createPanelWindow(["d1", "d2"], "row");
    const id = (await useApp.getState().saveAsPlotRecipe("Mapped pair", "d1", win))!;
    useApp.setState({ datasets: [dataset("d1"), dataset("d2"), dataset("d4")], plotWindows: [] });

    expect(await useApp.getState().applyPlotRecipe(id, "d4")).toBe(true);
    expect(useApp.getState().mapViews.d4).toMatchObject({ colormap: "magma", logZ: true, colorLimits: [1, 100] });
  });

  it("stages a missing dataset as a panel issue; a rebind fills it before the confirm", async () => {
    const id = await saveTrio();
    const saved = useApp.getState().plotRecipes;
    useApp.setState({ datasets: [dataset("d2"), dataset("d4"), dataset("d9")], plotWindows: [], plotRecipes: saved }); // d3 gone

    expect(await useApp.getState().applyPlotRecipe(id, "d4")).toBe(false);
    const pending = useApp.getState().pendingRecipeApplication;
    expect(pending?.resolution.unmatched).toEqual(['Panel 3 dataset ("d3.xy")']);
    expect(pending?.resolution.panelIssues).toEqual([{ panel: 2, kind: "dataset", name: "d3.xy" }]);
    expect(panelWindows()).toHaveLength(0); // zero mutation while staged

    await useApp.getState().rebindPendingRecipePanel(2, { datasetId: "d9" });
    expect(useApp.getState().pendingRecipeApplication?.resolution.unmatched).toEqual([]);

    expect(await useApp.getState().confirmPendingRecipeApplicationPartial()).toBe(true);
    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(panelWindows()[0].panel).toEqual({ datasetIds: ["d4", "d2", "d9"], layout: "row" });
  });
});
