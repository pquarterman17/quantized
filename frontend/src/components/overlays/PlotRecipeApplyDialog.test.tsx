// P1.3 wave 3, Lane D: the recipe apply preview+confirm dialog.
//
// ORCHESTRATOR RULING A (code-review finding 1): the dialog only ever opens
// when `unmatched.length > 0` (a clean match applies immediately, never
// stages), and the modal blocks dataset edits while it's up -- so a plain
// "Confirm" button that re-resolves would ALWAYS reproduce the identical
// unmatched set and, under the old wording, falsely claim "the dataset
// changed". Confirm is removed from the dialog entirely; the two remaining
// actions are Cancel and the (now primary) "Apply mapped fields" partial
// apply. `confirmPendingRecipeApplication` stays in the store as API for a
// future non-modal caller (see plotRecipes.test.ts for its own coverage,
// including the identical-re-resolution wording fix).

import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { captureRecipe } from "../../lib/plotRecipe";
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
  it("shows the mapping preview and the unmatched field", async () => {
    await stagePending();
    render(<PlotRecipeApplyDialog />);

    expect(screen.getByText(/Apply Plot Recipe/)).toBeInTheDocument();
    expect(screen.getByText("X axis")).toBeInTheDocument();
    expect(screen.getByText("2theta")).toBeInTheDocument();
    expect(screen.getByText(/Unmatched fields \(1\)/)).toBeInTheDocument();
  });

  // RULING A, red-first requirement 1: exactly two actions, ever -- no
  // "Confirm" button that can never succeed while the dialog is up.
  it("renders EXACTLY two actions: Cancel and Apply mapped fields", async () => {
    await stagePending();
    render(<PlotRecipeApplyDialog />);

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Cancel",
      "Apply mapped fields (drops 1 unmatched)",
    ]);
    expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("Cancel clears the pending application with zero mutation", async () => {
    await stagePending();
    render(<PlotRecipeApplyDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(0);
  });

  it("'Apply mapped fields' applies the resolved subset, dropping the unmatched field", async () => {
    await stagePending();
    render(<PlotRecipeApplyDialog />);

    fireEvent.click(screen.getByRole("button", { name: /Apply mapped fields/ }));
    await Promise.resolve();
    await Promise.resolve();

    expect(useApp.getState().pendingRecipeApplication).toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(useApp.getState().status).toContain("dropped 1 unmatched field");
  });
});
