// P1.3 wave 3, Lane D: the Recipe Manager panel view.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { captureRecipe, type PlotRecipe } from "../../../lib/plotRecipe";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { useApp } from "../../../store/useApp";
import RecipeManagerPanel from "./RecipeManagerPanel";

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
    activeId: "d1",
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

describe("RecipeManagerPanel — listing", () => {
  it("shows an empty-state message with no recipes in either scope", () => {
    render(<RecipeManagerPanel />);
    expect(screen.getByText(/No saved Plot Recipes yet/)).toBeInTheDocument();
  });

  it("lists project and global recipes together, tagged by scope", () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Project Recipe")] });
    useGlobalPlotRecipes.getState().setAll([recipe("g1", "Global Recipe")]);

    render(<RecipeManagerPanel />);

    expect(screen.getByText("Project Recipe")).toBeInTheDocument();
    expect(screen.getByText("Global Recipe")).toBeInTheDocument();
    expect(screen.getAllByText("Project")).not.toHaveLength(0);
    expect(screen.getAllByText("Global")).not.toHaveLength(0);
  });
});

describe("RecipeManagerPanel — actions", () => {
  it("renames a project recipe inline", () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Original")] });
    render(<RecipeManagerPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Rename Original");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useApp.getState().plotRecipes[0].name).toBe("Renamed");
  });

  it("duplicates a global recipe", () => {
    useGlobalPlotRecipes.getState().setAll([recipe("g1", "Original")]);
    render(<RecipeManagerPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(useGlobalPlotRecipes.getState().recipes.map((r) => r.name)).toEqual(["Original", "Original copy"]);
  });

  it("deletes a recipe", () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Original")] });
    render(<RecipeManagerPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(useApp.getState().plotRecipes).toHaveLength(0);
  });

  it("moves a project recipe to global scope", () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Original")] });
    render(<RecipeManagerPanel />);

    fireEvent.click(screen.getByRole("button", { name: "→ Global" }));

    expect(useApp.getState().plotRecipes).toHaveLength(0);
    expect(useGlobalPlotRecipes.getState().recipes.map((r) => r.name)).toEqual(["Original"]);
  });

  it("applies a recipe to the pre-selected active dataset and closes on a clean apply", async () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Original")] });
    const figuresBefore = useApp.getState().editableFigures.length;

    render(<RecipeManagerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // STATE, not the call itself -- waits on the real async apply-path
    // (recipeLibs()'s dynamic import) to actually land its figure.
    await waitFor(() => expect(useApp.getState().editableFigures).toHaveLength(figuresBefore + 1));
  });

  it("surfaces the malformed-import error message inline", async () => {
    render(<RecipeManagerPanel />);
    const input = screen.getByRole("button", { name: "Import to Project…" });
    fireEvent.click(input);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["not json"], "bad.json", { type: "application/json" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    fireEvent.change(fileInput);

    await Promise.resolve();
    await Promise.resolve();

    expect(await screen.findByText(/plot recipe file/i)).toBeInTheDocument();
  });
});
