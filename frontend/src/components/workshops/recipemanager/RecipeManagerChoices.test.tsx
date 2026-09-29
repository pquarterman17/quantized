// F4.2 / audit P1.3: the Recipe Manager's preview thumbnails and its
// apply-time choices (style template, transformation). Real stores; every
// wait is on STATE, never on a mocked call.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { BUILTIN_PLOT_RECIPES } from "../../../lib/builtinPlotRecipes";
import { captureRecipe, type PlotRecipe } from "../../../lib/plotRecipe";
import { defaultPlotView } from "../../../lib/plotview";
import { deleteTemplate, saveTemplate, toTemplate } from "../../../lib/template";
import type { Dataset } from "../../../lib/types";
import { useGlobalPlotRecipes } from "../../../store/globalPlotRecipes";
import { recipeLibs } from "../../../store/plotRecipeApply";
import { useApp } from "../../../store/useApp";
import RecipeManagerPanel from "./RecipeManagerPanel";

const ds: Dataset = {
  id: "d1",
  name: "d1.xy",
  data: {
    time: [0, 1, 2],
    values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
    labels: ["2theta", "Intensity", "Ierr"],
    units: ["deg", "cps", "cps"],
    metadata: { technique: "xrd.powder" },
  },
};

function recipe(id: string, name: string): PlotRecipe {
  return captureRecipe(ds, { ...defaultPlotView(), xKey: 0, yKeys: [1], plotTemplate: "nature" }, null, { id, name, appVersion: "0" });
}

// Same cold-chunk hoist as RecipeManagerPanel.test.tsx: the apply path's
// first dynamic import is paid here, outside every test's waitFor budget.
beforeAll(async () => {
  await recipeLibs();
});

beforeEach(() => {
  localStorage.clear();
  useApp.setState({
    datasets: [ds],
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

describe("RecipeManagerPanel — preview thumbnails", () => {
  it("draws a captured recipe's preview, one polyline per captured series", () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Scan")] });
    render(<RecipeManagerPanel />);
    const thumb = screen.getByRole("img", { name: "Scan: preview" });
    expect(thumb.querySelectorAll("polyline")).toHaveLength(1);
  });

  it("shows an honest empty frame, not a made-up curve, for a recipe without a preview", () => {
    render(<RecipeManagerPanel />);
    const thumb = screen.getByRole("img", { name: `${BUILTIN_PLOT_RECIPES[0].name}: no preview` });
    expect(thumb.querySelectorAll("polyline")).toHaveLength(0);
  });
});

const picker = (name: string) => screen.getByLabelText<HTMLSelectElement>(`Transformation for ${name}`);
const selectedText = (sel: HTMLSelectElement) => sel.options[sel.selectedIndex]?.textContent;
const withTransform = (id: string, name: string, transform: { name: string; revision: number }): PlotRecipe => ({
  ...recipe(id, name),
  transform,
});

describe("RecipeManagerPanel — apply-time choices", () => {
  it("defaults to the recipe's own style template, and to no transformation when none was recorded", () => {
    saveTemplate(toTemplate("Normalize", [], [], { revision: 4 }));
    useApp.setState({ plotRecipes: [recipe("p1", "Scan")] });
    render(<RecipeManagerPanel />);
    expect(screen.getByLabelText<HTMLSelectElement>("Style template").value).toBe("");
    expect(picker("Scan").value).toBe("");
  });

  it("lists the saved transformation recipes to choose from", () => {
    saveTemplate(toTemplate("Normalize", [], [], { revision: 4 }));
    useApp.setState({ plotRecipes: [recipe("p1", "Scan")] });
    render(<RecipeManagerPanel />);
    const options = within(picker("Scan")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["None", "Normalize (r4)"]);
  });

  it("offers no transformation picker when nothing is saved and nothing was recorded", () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Scan")] });
    render(<RecipeManagerPanel />);
    expect(screen.queryByLabelText("Transformation for Scan")).toBeNull();
  });

  // F4.2c owner decision (c): "Pre-select but also easy override."
  it("pre-selects the transformation the recipe recorded, marked as recorded", () => {
    saveTemplate(toTemplate("Normalize", [], [], { revision: 4 }));
    saveTemplate(toTemplate("Other", [], [], { revision: 1 }));
    useApp.setState({ plotRecipes: [withTransform("p1", "Scan", { name: "Normalize", revision: 4 }), recipe("p2", "Plain")] });
    render(<RecipeManagerPanel />);
    expect(picker("Scan").value).toBe("Normalize");
    expect(selectedText(picker("Scan"))).toBe("Normalize (r4) (recorded)");
    expect(picker("Plain").value).toBe("");
  });

  it("says which revision was recorded when the saved transformation has changed since", () => {
    saveTemplate(toTemplate("Normalize", [], [], { revision: 5 }));
    useApp.setState({ plotRecipes: [withTransform("p1", "Scan", { name: "Normalize", revision: 2 })] });
    render(<RecipeManagerPanel />);
    expect(selectedText(picker("Scan"))).toBe("Normalize (r5) (recorded as r2)");
  });

  it("defaults to None and says so next to the picker when the recorded transformation is gone", () => {
    saveTemplate(toTemplate("Normalize", [], [], { revision: 1 }));
    useApp.setState({ plotRecipes: [withTransform("p1", "Scan", { name: "Gone", revision: 3 })] });
    render(<RecipeManagerPanel />);
    expect(picker("Scan").value).toBe("");
    const row = screen.getByText("Scan").closest("li") as HTMLElement;
    expect(within(row).getByText("Recorded transformation “Gone” is no longer saved, so it defaults to None.")).toBeInTheDocument();
  });

  it("runs the pre-selected transformation when Apply is pressed without changing it", async () => {
    saveTemplate(toTemplate("Normalize", [], [], { revision: 1 }));
    useApp.setState({ plotRecipes: [withTransform("p1", "Scan", { name: "Normalize", revision: 1 })] });
    render(<RecipeManagerPanel />);
    const row = screen.getByText("Scan").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));
    // A step-less transformation derives nothing, so its own refusal proves it was the one run.
    expect(await screen.findByText(/transformation “Normalize” did not run/)).toBeInTheDocument();
    expect(useApp.getState().plotWindows).toHaveLength(0);
  });

  it("overrides the recorded transformation with None in one action", async () => {
    saveTemplate(toTemplate("Normalize", [], [], { revision: 1 }));
    useApp.setState({ plotRecipes: [withTransform("p1", "Scan", { name: "Normalize", revision: 1 })] });
    render(<RecipeManagerPanel />);
    fireEvent.change(picker("Scan"), { target: { value: "" } });
    expect(selectedText(picker("Scan"))).toBe("None");
    const row = screen.getByText("Scan").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(useApp.getState().plotWindows).toHaveLength(1));
    expect(useApp.getState().plotWindows[0].document?.bindings.datasetId).toBe("d1");
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("applies with the chosen style template, leaving the saved recipe as it was", async () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Scan")] });
    render(<RecipeManagerPanel />);
    fireEvent.change(screen.getByLabelText("Style template"), { target: { value: "poster" } });
    const row = screen.getByText("Scan").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(useApp.getState().plotWindows).toHaveLength(1));
    expect(useApp.getState().plotWindows[0].document?.plot.view.plotTemplate).toBe("poster");
    expect(useApp.getState().plotRecipes[0].visual.plotTemplate).toBe("nature");
  });

  it("shows a vanished transformation's refusal inline and creates nothing", async () => {
    saveTemplate(toTemplate("Normalize", [], [], { revision: 1 }));
    useApp.setState({ plotRecipes: [recipe("p1", "Scan")] });
    render(<RecipeManagerPanel />);
    fireEvent.change(picker("Scan"), { target: { value: "Normalize" } });
    localStorage.clear(); // deleted in another tab between choosing and applying
    const row = screen.getByText("Scan").closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Apply" }));

    expect(await screen.findByText(/transformation “Normalize” is no longer saved/)).toBeInTheDocument();
    expect(useApp.getState().plotWindows).toHaveLength(0);
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});

// Audit item 5: the Transform picker read the saved list once per mount, so a
// transformation saved or deleted while the manager was open never showed.
describe("RecipeManagerPanel — live saved-transformation list", () => {
  it("lists a transformation saved while the manager is open", () => {
    useApp.setState({ plotRecipes: [recipe("p1", "Scan")] });
    render(<RecipeManagerPanel />);
    expect(screen.queryByLabelText("Transformation for Scan")).toBeNull();
    act(() => void saveTemplate(toTemplate("Normalize", [], [], { revision: 2 })));
    const options = within(picker("Scan")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["None", "Normalize (r2)"]);
  });

  it("drops a deleted transformation and falls back from a pick of it", () => {
    saveTemplate(toTemplate("Normalize", [], [], { revision: 1 }));
    saveTemplate(toTemplate("Other", [], [], { revision: 1 }));
    useApp.setState({ plotRecipes: [recipe("p1", "Scan")] });
    render(<RecipeManagerPanel />);
    fireEvent.change(picker("Scan"), { target: { value: "Normalize" } });
    act(() => void deleteTemplate("Normalize"));
    expect(within(picker("Scan")).getAllByRole("option").map((o) => o.textContent)).toEqual(["None", "Other (r1)"]);
    expect(picker("Scan").value).toBe("");
  });

  it("re-targets Apply to when the chosen dataset is deleted", () => {
    const other: Dataset = { ...ds, id: "d2", name: "d2.xy" };
    useApp.setState({ datasets: [ds, other], activeId: "d1", plotRecipes: [recipe("p1", "Scan")] });
    render(<RecipeManagerPanel />);
    const target = screen.getByLabelText<HTMLSelectElement>("Apply to dataset");
    fireEvent.change(target, { target: { value: "d2" } });
    act(() => useApp.setState({ datasets: [ds] }));
    expect(target.value).toBe("d1");
  });
});
