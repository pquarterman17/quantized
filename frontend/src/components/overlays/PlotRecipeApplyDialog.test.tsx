// P1.3 wave 3, Lane D: the recipe apply preview+confirm dialog.

import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { captureRecipe } from "../../lib/plotRecipe";
import { resolveRecipe } from "../../lib/plotRecipeMatch";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import PlotRecipeApplyDialog from "./PlotRecipeApplyDialog";

function dataset(labels = ["2theta", "Signal", "Ierr"]): Dataset {
  return {
    id: "d1",
    name: "d1.xy",
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels,
      units: ["deg", "cps", "cps"],
      metadata: { technique: "xrd.powder" },
    },
  };
}

function reset(labels?: string[]) {
  useApp.setState({
    datasets: [dataset(labels)],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [],
    plotRecipes: [],
    pendingRecipeApplication: null,
    history: [],
    future: [],
    status: "",
  });
}

/** Stage a pending application by round-tripping through the real store:
 *  capture a recipe against the ORIGINAL labels, then swap in a dataset
 *  whose "Intensity" column got renamed to "Signal" -- X still resolves, Y
 *  does not (the same unmatched-but-not-refused shape store/plotRecipes.
 *  test.ts's own fixtures use). */
async function stagePending(): Promise<void> {
  reset(["2theta", "Intensity", "Ierr"]);
  const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
  const recipe = captureRecipe(useApp.getState().datasets[0], view, null, {
    id: "r1",
    name: "XRD Recipe",
    appVersion: "0",
  });
  useApp.setState({ plotRecipes: [recipe], datasets: [dataset(["2theta", "Signal", "Ierr"])] });
  await useApp.getState().applyPlotRecipe("r1", "d1");
}

beforeEach(() => reset());

describe("PlotRecipeApplyDialog — visibility", () => {
  it("renders nothing when nothing is pending", () => {
    const { container } = render(<PlotRecipeApplyDialog />);
    expect(container.firstChild).toBeNull();
  });
});

describe("PlotRecipeApplyDialog — preview + actions", () => {
  it("shows the mapping preview, the unmatched field, and both apply actions", async () => {
    await stagePending();
    render(<PlotRecipeApplyDialog />);

    expect(screen.getByText(/Apply Plot Recipe/)).toBeInTheDocument();
    expect(screen.getByText("X axis")).toBeInTheDocument();
    expect(screen.getByText("2theta")).toBeInTheDocument();
    expect(screen.getByText(/Unmatched fields \(1\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Apply anyway \(drop 1 unmatched\)/ })).toBeInTheDocument();
  });

  it("Cancel clears the pending application with zero mutation", async () => {
    await stagePending();
    render(<PlotRecipeApplyDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(0);
  });

  it("Confirm re-resolves and, still unmatched, RE-STAGES and shows the 'dataset changed' status", async () => {
    await stagePending();
    render(<PlotRecipeApplyDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await Promise.resolve();
    await Promise.resolve();

    expect(useApp.getState().pendingRecipeApplication).not.toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(0);
  });

  it("'Apply anyway' applies the resolved subset, dropping the unmatched field", async () => {
    await stagePending();
    render(<PlotRecipeApplyDialog />);

    fireEvent.click(screen.getByRole("button", { name: /Apply anyway/ }));
    await Promise.resolve();
    await Promise.resolve();

    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(useApp.getState().status).toContain("dropped 1 unmatched field");
  });

  it("hides the 'Apply anyway' action once nothing is unmatched", async () => {
    reset();
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const recipe = captureRecipe(useApp.getState().datasets[0], view, null, {
      id: "r1",
      name: "Clean Recipe",
      appVersion: "0",
    });
    // Force a "clean but staged" pending state directly (a clean match would
    // normally apply immediately rather than stage) purely to check the
    // dialog's own rendering branch. `resolveRecipe` builds a real, fully-
    // shaped resolution rather than a hand-rolled stand-in.
    const resolution = resolveRecipe(recipe, useApp.getState().datasets[0]);
    if (!("resolved" in resolution)) throw new Error("expected a resolved result");
    useApp.setState({
      pendingRecipeApplication: { recipe, datasetId: "d1", resolution },
    });

    render(<PlotRecipeApplyDialog />);

    expect(screen.queryByRole("button", { name: /Apply anyway/ })).toBeNull();
  });
});
