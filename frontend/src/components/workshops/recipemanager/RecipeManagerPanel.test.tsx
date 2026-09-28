// P1.3 wave 3, Lane D: the Recipe Manager panel view.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BUILTIN_PLOT_RECIPES } from "../../../lib/builtinPlotRecipes";
import { captureRecipe, type PlotRecipe } from "../../../lib/plotRecipe";
import { defaultPlotView } from "../../../lib/plotview";
import type { Dataset } from "../../../lib/types";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { recipeLibs } from "../../../store/plotRecipeApply";
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

// The apply path awaits `recipeLibs()` (`store/plotRecipeApply.ts`), a
// module-memoized `Promise.all` over two REAL dynamic `import()`s. The tests
// below rightly wait on STATE rather than on a call, but `waitFor`'s budget is
// 1 s by default and the FIRST caller in this module pays the whole cold
// transform+import inside that budget -- measured at ~89 ms on an idle machine
// here, against a full 610-file parallel run whose reported environment time
// alone was ~700 s. That is the shape of the two intermittent
// `expected [] to have a length of 1` failures seen while landing the axis-box
// default (green in isolation, green on re-run), so the chunk load is hoisted
// OUT of every test's budget instead of the budget being widened. `_recipeLibs`
// is module-scoped and memoized, so one await here serves the whole file, and
// what each test then measures is the apply logic alone.
beforeAll(async () => {
  await recipeLibs();
});

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
    // The project row renders FIRST (combinedRecipeRows, project before
    // global, before the separate "Built-in" group below it) -- [0] is
    // always this test's own "Original" row, never a built-in's.
    fireEvent.click(screen.getAllByRole("button", { name: "Apply" })[0]);

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
    const applyButton = screen.getAllByRole("button", { name: "Apply" })[0]; // this test's row, see above
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
    fireEvent.click(screen.getAllByRole("button", { name: "Apply" })[0]); // the project row, see above

    await waitFor(() => expect(useApp.getState().status).toContain("unavailable"));
    expect(useApp.getState().pendingRecipeApplication).toBe(preExisting); // identity, untouched
    expect(useRecipeManager.getState().open).toBe(true); // the panel never closed itself
  });

  // FINDING 5 (code-review, this round): `applyRow` had no catch/finally, so
  // a REJECTED lazy-chunk apply (the apply path's matcher/capture chunk
  // failing to fetch) left `applying`/`applyingRef` stuck `true` forever --
  // every Apply button in the panel stayed disabled for the rest of the
  // session, with no visible sign of what happened.
  it("a rejected lazy-chunk apply surfaces the error inline and never leaves Apply stuck disabled", async () => {
    // Restored in `finally` below -- overriding the store's OWN action
    // leaks across every later test in this file otherwise (unlike
    // `plotRecipes`/`status`/etc., `beforeEach` never resets action fields).
    const realApply = useApp.getState().applyPlotRecipeObject;
    try {
      useApp.setState({
        plotRecipes: [recipe("p1", "Original")],
        applyPlotRecipeObject: () => Promise.reject(new Error("chunk 404")),
      });
      render(<RecipeManagerPanel />);
      const applyButton = screen.getAllByRole("button", { name: "Apply" })[0]; // the project row, see above

      fireEvent.click(applyButton);

      expect(await screen.findByText(/chunk 404/)).toBeInTheDocument();
      // Re-enabled -- `finally` resets `applying`/`applyingRef` on EVERY path,
      // not only the ones the old `.then`-only chain covered.
      await waitFor(() => expect(applyButton).not.toBeDisabled());
    } finally {
      useApp.setState({ applyPlotRecipeObject: realApply });
    }
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

// P2.1 "Technique-specific plot recipe is manually chosen, never
// auto-overwrites". The panel is the one place a person can reach a
// built-in -- see lib/builtinPlotRecipes.ts's module doc for why nothing
// else (import, technique detection, the post-import suggestion toast) can.
describe("RecipeManagerPanel — built-in recipes", () => {
  it("lists every built-in recipe, unconditionally, in their own group", () => {
    render(<RecipeManagerPanel />);
    // The section header AND each row's own scope tag both read "Built-in" --
    // at least one of each (header + one tag per recipe below).
    expect(screen.getAllByText("Built-in").length).toBeGreaterThanOrEqual(1 + BUILTIN_PLOT_RECIPES.length);
    for (const recipe of BUILTIN_PLOT_RECIPES) {
      expect(screen.getByText(recipe.name)).toBeInTheDocument();
    }
  });

  it("offers Apply and Copy to Project, but never Rename/Duplicate/Delete/Export, on a built-in row", () => {
    render(<RecipeManagerPanel />);
    const row = screen.getByText(BUILTIN_PLOT_RECIPES[0].name).closest("li");
    expect(row).not.toBeNull();
    const withinRow = within(row as HTMLElement);
    expect(withinRow.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(withinRow.getByRole("button", { name: "Copy to Project" })).toBeInTheDocument();
    // Sabotage-verified (see the task's own self-review pass): rendering a
    // Delete button here made this assertion fail before the row was fixed
    // to omit it, confirming the query actually exercises the panel's markup.
    expect(withinRow.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(withinRow.queryByRole("button", { name: "Duplicate" })).toBeNull();
    expect(withinRow.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(withinRow.queryByRole("button", { name: "Export" })).toBeNull();
  });

  it("'Copy to Project' on a built-in lands an independent, fully-editable project recipe -- the built-in itself untouched", () => {
    render(<RecipeManagerPanel />);
    const xrd = BUILTIN_PLOT_RECIPES.find((r) => r.technique === "xrd.powder");
    if (!xrd) throw new Error("expected an xrd.powder built-in recipe");
    const row = screen.getByText(xrd.name).closest("li");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Copy to Project" }));

    expect(useApp.getState().plotRecipes).toHaveLength(1);
    const copy = useApp.getState().plotRecipes[0];
    expect(copy.name).toBe(xrd.name); // no project recipe existed yet to dedupe against
    expect(copy.id).not.toBe(xrd.id); // fresh id -- never the built-in's own
    expect(BUILTIN_PLOT_RECIPES).toHaveLength(3); // the source list itself is untouched
    // FINDING 7 (code-review): flagged out of automatic suggestion, and
    // confirmed with a status line -- neither existed before this round.
    expect(copy.noAutoSuggest).toBe(true);
    expect(useApp.getState().status).toContain(xrd.name);

    // The copy landed as an ordinary PROJECT-scope row (found by its scope
    // tag, not by name -- the copy shares the built-in's name, so a
    // by-text query would now be ambiguous) -- renamable/deletable like any
    // other project recipe.
    const copyRow = screen.getByText("Project").closest("li");
    expect(copyRow).not.toBeNull();
    expect(within(copyRow as HTMLElement).getByText(xrd.name)).toBeInTheDocument();
    fireEvent.click(within(copyRow as HTMLElement).getByRole("button", { name: "Delete" }));
    expect(useApp.getState().plotRecipes).toHaveLength(0);
  });

  it("applies a built-in recipe to the selected dataset (one new figure, one undo step)", async () => {
    useApp.setState({
      datasets: [dataset("d1")],
      activeId: "d1",
    });
    const xrd = BUILTIN_PLOT_RECIPES.find((r) => r.technique === "xrd.powder");
    if (!xrd) throw new Error("expected an xrd.powder built-in recipe");
    const figuresBefore = useApp.getState().editableFigures.length;

    render(<RecipeManagerPanel />);
    const row = screen.getByText(xrd.name).closest("li");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(useApp.getState().editableFigures).toHaveLength(figuresBefore + 1));
    const applied = useApp.getState().editableFigures[useApp.getState().editableFigures.length - 1];
    expect(applied.plot.mark).toBe("line");

    // One undo step: undo removes exactly the figure this apply created.
    useApp.getState().undo();
    expect(useApp.getState().editableFigures).toHaveLength(figuresBefore);
  });
});
