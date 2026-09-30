// F4.4 SPATIAL half / audit P1.3 "maps/panels": a plot recipe saved from a
// spatial multi-panel window captures the composition BY NAME and rebuilds
// it on apply -- panel layout, per-panel dataset bindings, and the map view.
// Exercises the real `useApp` store end to end (the same style
// plotRecipes.test.ts uses for the facet and x-break rebuilds).

import { beforeEach, describe, expect, it } from "vitest";

import { spatialComposition, spatialPanelsOf } from "../lib/composition";
import { mapViewFor } from "../lib/mapView";
import type { SpatialPanel } from "../lib/multipanel";
import { defaultPlotView, type PlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { useGlobalPlotRecipes } from "./globalPlotRecipes";
import { useApp } from "./useApp";

const UNITS: Record<string, string> = { "2theta": "deg", Intensity: "cps", Ierr: "cps" };

/** Units follow their label, so a reordered-column fixture stays the SAME
 *  physical columns (a unit change is its own resolve warning). */
function dataset(id: string, labels = ["2theta", "Intensity", "Ierr"]): Dataset {
  return {
    id,
    name: `${id}.xy`,
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels,
      units: labels.map((l) => UNITS[l] ?? ""),
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
    techniqueViewMemory: {},
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

function focusPlotWindow(datasetId: string, viewOverrides: Partial<PlotView> = {}): string {
  const view = { ...defaultPlotView(), ...viewOverrides };
  const id = useApp.getState().createWindow(datasetId, view, "Win");
  useApp.getState().focusWindow(id);
  return id;
}

/** A two-panel spatial window: the focused dataset on top, a sibling below. */
function twoPanels(): SpatialPanel[] {
  return [
    { datasetId: "d1", xKey: 0, yKeys: [1], xLim: [0, 40], yLim: [1, 1000], xLog: false, yLog: true, seriesLabels: { 1: "I" }, row: 0, col: 0 },
    { datasetId: "d2", xKey: 0, yKeys: [1, 2], xLim: [5, 35], yLim: [0, 300], xLog: false, yLog: false, row: 1, col: 0 },
  ];
}

/** Save a recipe from a live 2-panel window on d1 (+ d2 as the sibling). */
async function saveTwoPanelRecipe(): Promise<string> {
  resetStore([dataset("d1"), dataset("d2")]);
  focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
  useApp.setState({ composition: spatialComposition(twoPanels()), stackMode: true, panelFit: "window" });
  const id = await useApp.getState().saveAsPlotRecipe("Two-panel", "d1");
  expect(id).not.toBeNull();
  return id!;
}

beforeEach(() => resetStore([dataset("d1")]));

describe("saveAsPlotRecipe from a spatial window", () => {
  it("captures every panel by name, the sibling by dataset name, and the fit mode", async () => {
    await saveTwoPanelRecipe();
    const [recipe] = useApp.getState().plotRecipes;
    expect(recipe.visual.compositionKind).toBe("spatial");
    expect(recipe.panels?.panelFit).toBe("window");
    expect(recipe.panels?.panels.map((p) => p.dataset)).toEqual([null, "d2.xy"]);
    expect(recipe.panels?.panels[1]).toMatchObject({ x: "2theta", y: ["Intensity", "Ierr"], row: 1 });
  });

  it("records the source dataset's non-default map view", async () => {
    resetStore([dataset("d1")]);
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    useApp.setState({ mapViews: { d1: { colormap: "magma", logZ: true, colorLimits: [1, 100], slices: [], annotations: [] } } });
    await useApp.getState().saveAsPlotRecipe("Mapped", "d1");
    expect(useApp.getState().plotRecipes[0].map).toEqual({ colormap: "magma", logZ: true, colorLimits: [1, 100] });
  });
});

describe("applyPlotRecipe rebuilds a live SPATIAL composition (F4.4)", () => {
  it("round-trips a 2-panel window: the target takes the recipe's own panel, the sibling binds by name, columns by label", async () => {
    const id = await saveTwoPanelRecipe();
    const saved = useApp.getState().plotRecipes;
    // The target's columns are REORDERED -- every panel channel re-keys by label.
    const d3 = dataset("d3", ["Ierr", "Intensity", "2theta"]);
    useApp.setState({ datasets: [dataset("d1"), dataset("d2"), d3], plotRecipes: saved });

    expect(await useApp.getState().applyPlotRecipe(id, "d3")).toBe(true);

    const s = useApp.getState();
    const panels = spatialPanelsOf(s.composition);
    expect(panels?.map((p) => [p.datasetId, p.xKey, p.yKeys])).toEqual([
      ["d3", 2, [1]],
      ["d2", 0, [1, 2]],
    ]);
    expect(panels?.[0]).toMatchObject({ yLog: true, yLim: [1, 1000], seriesLabels: { 1: "I" }, row: 0 });
    expect(s.stackMode).toBe(true);
    expect(s.panelFit).toBe("window");
    expect(s.activeId).toBe("d3");
    expect(s.editableFigures).toHaveLength(1);
  });

  it("stages a missing sibling dataset as a panel issue, and a rebind resolves it before the confirm", async () => {
    const id = await saveTwoPanelRecipe();
    const saved = useApp.getState().plotRecipes;
    const d3 = dataset("d3");
    const stand = dataset("d9");
    useApp.setState({ datasets: [dataset("d1"), d3, stand], plotRecipes: saved, composition: null }); // d2 gone

    expect(await useApp.getState().applyPlotRecipe(id, "d3")).toBe(false);
    const pending = useApp.getState().pendingRecipeApplication;
    expect(pending?.resolution.unmatched).toEqual(['Panel 2 dataset ("d2.xy")']);
    expect(pending?.resolution.panelIssues).toEqual([{ panel: 1, kind: "dataset", name: "d2.xy" }]);
    expect(useApp.getState().composition).toBeNull(); // zero mutation while staged

    await useApp.getState().rebindPendingRecipePanel(1, { datasetId: "d9" });
    const rebound = useApp.getState().pendingRecipeApplication;
    expect(rebound?.resolution.unmatched).toEqual([]);
    expect(rebound?.panelBindings).toEqual({ 1: { datasetId: "d9" } });

    expect(await useApp.getState().confirmPendingRecipeApplicationPartial()).toBe(true);
    const s = useApp.getState();
    expect(s.pendingRecipeApplication).toBeNull();
    expect(spatialPanelsOf(s.composition)?.map((p) => p.datasetId)).toEqual(["d3", "d9"]);
    expect(s.status).not.toContain("dropped");
  });

  it("applies the captured map view onto the TARGET dataset's own map view", async () => {
    resetStore([dataset("d1")]);
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    useApp.setState({ mapViews: { d1: { colormap: "magma", logZ: true, colorLimits: [1, 100], slices: [], annotations: [] } } });
    const id = (await useApp.getState().saveAsPlotRecipe("Mapped", "d1"))!;
    useApp.setState({ datasets: [dataset("d1"), dataset("d2")], plotRecipes: useApp.getState().plotRecipes });

    expect(await useApp.getState().applyPlotRecipe(id, "d2")).toBe(true);

    const view = mapViewFor(useApp.getState().mapViews, "d2");
    expect(view).toMatchObject({ colormap: "magma", logZ: true, colorLimits: [1, 100] });
    expect(mapViewFor(useApp.getState().mapViews, "d1").colormap).toBe("magma"); // the source is untouched
  });

  it("a plain recipe still leaves composition null and the map view untouched", async () => {
    focusPlotWindow("d1", { xKey: 0, yKeys: [1] });
    const id = (await useApp.getState().saveAsPlotRecipe("Plain", "d1"))!;
    useApp.setState({ datasets: [dataset("d1"), dataset("d2")], plotRecipes: useApp.getState().plotRecipes });
    expect(await useApp.getState().applyPlotRecipe(id, "d2")).toBe(true);
    expect(useApp.getState().composition).toBeNull();
    expect(useApp.getState().mapViews).toEqual({});
  });
});
