// P1.3 wave 3, Lane D: the Recipe Manager panel's cross-store action layer.
// Exercises the REAL useApp/useGlobalPlotRecipes stores (same "no mocking
// the store" convention store/plotRecipes.test.ts uses).

import { beforeEach, describe, expect, it } from "vitest";

import { captureRecipe, type PlotRecipe } from "../../../lib/plotRecipe";
import { defaultPlotView } from "../../../lib/plotview";
import { exportRecipeFile } from "../../../lib/plotRecipeStorage";
import type { Dataset } from "../../../lib/types";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useApp } from "../../../store/useApp";
import {
  applyRecipeToDataset,
  combinedRecipeRows,
  deleteRecipe,
  duplicateRecipe,
  importRecipeToScope,
  moveRecipeScope,
  renameRecipe,
} from "./recipeManagerActions";

function dataset(id = "d1"): Dataset {
  return {
    id,
    name: `${id}.xy`,
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels: ["2theta", "Intensity", "Ierr"],
      units: ["deg", "cps", "cps"],
      metadata: { technique: "xrd.powder" },
    },
  };
}

function recipe(id: string, name: string): PlotRecipe {
  const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
  return captureRecipe(dataset(), view, null, { id, name, appVersion: "0" });
}

beforeEach(() => {
  localStorage.clear();
  useApp.setState({
    datasets: [dataset()],
    plotRecipes: [],
    pendingRecipeApplication: null,
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    history: [],
    future: [],
    status: "",
  });
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: true });
});

describe("combinedRecipeRows", () => {
  it("tags project rows first, then global", () => {
    const rows = combinedRecipeRows([recipe("p1", "P")], [recipe("g1", "G")]);
    expect(rows).toEqual([
      { scope: "project", recipe: expect.objectContaining({ id: "p1" }) },
      { scope: "global", recipe: expect.objectContaining({ id: "g1" }) },
    ]);
  });
});

describe("renameRecipe / duplicateRecipe / deleteRecipe", () => {
  it("routes project-scope calls to useApp's actions", () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Original")] });
    renameRecipe("project", "p1", "Renamed");
    expect(useApp.getState().plotRecipes[0].name).toBe("Renamed");

    const dupId = duplicateRecipe("project", "p1");
    expect(dupId).not.toBeNull();
    expect(useApp.getState().plotRecipes).toHaveLength(2);

    deleteRecipe("project", "p1");
    expect(useApp.getState().plotRecipes.map((r) => r.id)).not.toContain("p1");
  });

  it("routes global-scope calls to useGlobalPlotRecipes's actions", () => {
    useGlobalPlotRecipes.getState().setAll([recipe("g1", "Original")]);
    renameRecipe("global", "g1", "Renamed");
    expect(useGlobalPlotRecipes.getState().recipes[0].name).toBe("Renamed");

    const dupId = duplicateRecipe("global", "g1");
    expect(dupId).not.toBeNull();
    expect(useGlobalPlotRecipes.getState().recipes).toHaveLength(2);

    deleteRecipe("global", "g1");
    expect(useGlobalPlotRecipes.getState().recipes.map((r) => r.id)).not.toContain("g1");
  });
});

describe("moveRecipeScope", () => {
  it("moves project -> global, dedupes against the destination, and records ONE undo entry", () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Taken")] });
    useGlobalPlotRecipes.getState().setAll([recipe("g1", "Taken")]);
    const historyBefore = useApp.getState().history.length;

    moveRecipeScope("project", "p1");

    expect(useApp.getState().plotRecipes).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(historyBefore + 1);
    const globalNames = useGlobalPlotRecipes.getState().recipes.map((r) => r.name);
    expect(globalNames).toEqual(["Taken", "Taken (2)"]);

    useApp.getState().undo();
    expect(useApp.getState().plotRecipes.map((r) => r.id)).toEqual(["p1"]);
  });

  it("moves global -> project, dedupes against the destination", () => {
    useGlobalPlotRecipes.getState().setAll([recipe("g1", "Taken")]);
    useApp.setState({ plotRecipes: [recipe("p1", "Taken")] });

    moveRecipeScope("global", "g1");

    expect(useGlobalPlotRecipes.getState().recipes).toHaveLength(0);
    const projectNames = useApp.getState().plotRecipes.map((r) => r.name);
    expect(projectNames).toEqual(["Taken", "Taken (2)"]);
  });

  it("is a no-op for an unknown id", () => {
    moveRecipeScope("project", "nope");
    expect(useApp.getState().plotRecipes).toHaveLength(0);
    expect(useGlobalPlotRecipes.getState().recipes).toHaveLength(0);
  });
});

describe("applyRecipeToDataset", () => {
  it("applies a GLOBAL recipe (never a member of state.plotRecipes) to a chosen dataset", async () => {
    const r = recipe("g1", "Global Recipe");
    useGlobalPlotRecipes.getState().setAll([r]);
    const windowsBefore = useApp.getState().plotWindows.length;

    const ok = await applyRecipeToDataset(r, "d1");

    expect(ok).toBe(true);
    expect(useApp.getState().plotWindows).toHaveLength(windowsBefore + 1);
  });
});

describe("exportRecipe round-trips with importRecipeToScope", () => {
  it("imports a serialized recipe into project scope with a FRESH id, deduped name", () => {
    const r = recipe("p1", "Exported");
    const text = exportRecipeFile(r);
    useApp.setState({ plotRecipes: [recipe("other", "Exported")] }); // force a name collision

    importRecipeToScope("project", text);

    const names = useApp.getState().plotRecipes.map((x) => x.name);
    expect(names).toEqual(["Exported", "Exported (2)"]);
    expect(useApp.getState().plotRecipes.map((x) => x.id)).not.toContain("p1");
  });

  it("imports into global scope", () => {
    const text = exportRecipeFile(recipe("p1", "Exported"));

    importRecipeToScope("global", text);

    expect(useGlobalPlotRecipes.getState().recipes).toHaveLength(1);
    expect(useGlobalPlotRecipes.getState().recipes[0].name).toBe("Exported");
  });

  it("throws with a clear message on malformed input, mutating neither store", () => {
    expect(() => importRecipeToScope("project", "not json")).toThrow();
    expect(useApp.getState().plotRecipes).toHaveLength(0);
  });
});
