// P1.3 wave 3, Lane D: the Recipe Manager panel view.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { captureRecipe, type PlotRecipe } from "../../../lib/plotRecipe";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import type { PendingPlotRecipeApplication } from "../../../store/plotRecipes";
import { useRecipeManager } from "../../../store/recipeManager";
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
  useRecipeManager.setState({ open: false });
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

  // ORCHESTRATOR RULING B (code-review findings 2+3): Move is replaced by
  // Copy -- the source row stays exactly where it was.
  it("copies a project recipe to global scope, leaving the project original untouched", () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Original")] });
    render(<RecipeManagerPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Copy to Global" }));

    expect(useApp.getState().plotRecipes.map((r) => r.name)).toEqual(["Original"]); // untouched
    expect(useGlobalPlotRecipes.getState().recipes.map((r) => r.name)).toEqual(["Original"]);
  });

  // FINDING 3 (code-review), belt-and-braces: rename state is keyed by
  // scope+id like the `<li>` key, so two rows that happen to share an id
  // across scopes (legacy data, or any future edge case) never cross-wire
  // their rename inputs.
  it("renames project and global rows independently even when they share the SAME id and name", () => {
    useApp.setState({ plotRecipes: [recipe("dup-id", "Same Name")] });
    useGlobalPlotRecipes.getState().setAll([recipe("dup-id", "Same Name")]);
    render(<RecipeManagerPanel />);

    const renameButtons = screen.getAllByRole("button", { name: "Rename" });
    expect(renameButtons).toHaveLength(2);
    fireEvent.click(renameButtons[0]); // the PROJECT row (rendered first)
    const input = screen.getByLabelText("Rename Same Name");
    fireEvent.change(input, { target: { value: "Renamed Project" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useApp.getState().plotRecipes[0].name).toBe("Renamed Project");
    expect(useGlobalPlotRecipes.getState().recipes[0].name).toBe("Same Name"); // untouched
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

  // FINDING 2 (code-review): both handlers from a rapid double-click pass
  // `applyRow`'s synchronous checks before either await on the apply
  // path's dynamic chunk load resolves, so without a guard, BOTH complete
  // and TWO figures land from one gesture.
  it("a rapid double-click on Apply creates only ONE figure", async () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Original")] });
    const figuresBefore = useApp.getState().editableFigures.length;

    render(<RecipeManagerPanel />);
    const applyButton = screen.getByRole("button", { name: "Apply" });
    fireEvent.click(applyButton);
    fireEvent.click(applyButton); // no await between -- the race

    await waitFor(() => expect(useApp.getState().editableFigures).toHaveLength(figuresBefore + 1));
    // Give a second, unguarded apply every chance to also land before
    // asserting it didn't.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore + 1);
  });

  // FINDING 5 (code-review): the manager can open OVER an existing staged
  // preview+confirm dialog (e.g. via the command palette) -- the panel's
  // close-on-staged check must be able to tell "THIS apply staged
  // something" from "a pending was already sitting there before I ever
  // clicked Apply". A refused apply (technique mismatch) never touches
  // `pendingRecipeApplication` at all, so the pre-existing one is still
  // there afterward -- the old `pendingRecipeApplication truthy` check
  // couldn't distinguish that from "I just staged one", and closed anyway.
  it("a refused apply with a pre-existing staged pending leaves it untouched AND keeps the panel open", async () => {
    const projectRecipe = recipe("p1", "XRD Recipe"); // captured for xrd.powder
    const mismatchedDataset = dataset("d2");
    mismatchedDataset.data.metadata = { technique: "magnetometry.mvsh" };
    useApp.setState({
      plotRecipes: [projectRecipe],
      datasets: [dataset("d1"), mismatchedDataset],
    });
    const preExisting = {
      recipe: projectRecipe,
      datasetId: "d1",
      resolution: {} as PendingPlotRecipeApplication["resolution"],
    } satisfies PendingPlotRecipeApplication;
    useApp.setState({ pendingRecipeApplication: preExisting });
    useRecipeManager.setState({ open: true });

    render(<RecipeManagerPanel />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "d2" } }); // mismatched technique
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(useApp.getState().status).toContain("unavailable"));
    expect(useApp.getState().pendingRecipeApplication).toBe(preExisting); // identity, untouched
    expect(useRecipeManager.getState().open).toBe(true); // the panel never closed itself
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

  // FINDING 8 (code-review): `file.text()` itself can reject (e.g. a read
  // error), not just resolve with malformed content -- the promise chain
  // needs a `.catch` routing into the same inline error, or this becomes an
  // unhandled rejection instead of a surfaced message.
  it("surfaces an error when the picked file's own read rejects", async () => {
    render(<RecipeManagerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Import to Project…" }));
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const rejecting = { text: () => Promise.reject(new Error("disk read failed")) } as unknown as File;
    Object.defineProperty(fileInput, "files", { value: [rejecting] });
    fireEvent.change(fileInput);

    expect(await screen.findByText(/disk read failed/i)).toBeInTheDocument();
  });
});
