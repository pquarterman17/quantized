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

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { spatialComposition } from "../../lib/composition";
import { captureRecipe } from "../../lib/plotRecipe";
import { defaultPlotView } from "../../lib/plotview";
import type { Dataset } from "../../lib/types";
import { useApp } from "../../store/useApp";
import PlotRecipeApplyDialog from "./PlotRecipeApplyDialog";

function dataset(labels = ["2theta", "Signal", "Ierr"], id = "d1"): Dataset {
  return {
    id,
    name: `${id}.xy`,
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

  // F4.2 / audit P1.3: the preview shows what the recipe LOOKS like, not
  // just which columns it maps -- the thumbnail captured when it was saved.
  it("shows the recipe's captured preview thumbnail", async () => {
    await stagePending();
    render(<PlotRecipeApplyDialog />);

    const thumb = screen.getByRole("img", { name: "XRD Recipe: preview" });
    expect(thumb.querySelectorAll("polyline")).toHaveLength(1);
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
    // The apply core is a lazy seam (bundle diet slice 3): the action crosses a
    // dynamic import() before it writes, so wait on the STATE it produces rather
    // than counting microtask ticks.
    await waitFor(() => expect(useApp.getState().pendingRecipeApplication).toBeNull());

    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(useApp.getState().status).toContain("dropped 1 unmatched field");
  });
});

// F4.4 SPATIAL half: a panel whose dataset (or column) is missing is NAMED
// with a rebind control, not just listed -- the user picks the stand-in and
// the staged resolution updates in place.
describe("PlotRecipeApplyDialog — spatial panel rebind", () => {
  async function stageSpatialPending(): Promise<void> {
    reset(["2theta", "Intensity", "Ierr"]);
    const d1 = dataset(["2theta", "Intensity", "Ierr"]);
    const d2 = dataset(["2theta", "Intensity", "Ierr"], "d2");
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const recipe = captureRecipe(
      d1,
      view,
      spatialComposition([
        { datasetId: "d1", xKey: 0, yKeys: [1], xLim: [0, 40], yLim: [1, 1000], xLog: false, yLog: true, row: 0, col: 0 },
        { datasetId: "d2", xKey: 0, yKeys: [1], xLim: [0, 40], yLim: [1, 1000], xLog: false, yLog: false, row: 1, col: 0 },
      ]),
      { id: "r1", name: "Two-panel", appVersion: "0", datasets: [d1, d2] },
    );
    // d2 is gone; d9 is available as a stand-in.
    useApp.setState({ plotRecipes: [recipe], datasets: [d1, dataset(["2theta", "Intensity", "Ierr"], "d9")] });
    await useApp.getState().applyPlotRecipe("r1", "d1");
  }

  it("names the missing panel dataset with a picker; choosing a stand-in re-resolves to a clean apply", async () => {
    await stageSpatialPending();
    render(<PlotRecipeApplyDialog />);

    expect(screen.getByText(/Missing panel bindings \(1\)/)).toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: 'Panel 2 dataset ("d2.xy")' });
    expect(screen.queryByText(/Unmatched fields/)).toBeNull(); // named once, with its control
    expect(screen.getByRole("button", { name: /Apply mapped fields \(drops 1 unmatched\)/ })).toBeInTheDocument();

    fireEvent.change(picker, { target: { value: "d9" } });
    await waitFor(() => expect(useApp.getState().pendingRecipeApplication?.resolution.unmatched).toEqual([]));

    expect(screen.queryByText(/Missing panel bindings/)).toBeNull();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
  });

  it("still shows the recipe's preview thumbnail beside the panel prompt, with its panel grid", async () => {
    await stageSpatialPending();
    render(<PlotRecipeApplyDialog />);
    const thumb = screen.getByRole("img", { name: "Two-panel: preview, 2×1 panels" });
    expect(thumb.querySelectorAll("polyline")).toHaveLength(1);
  });
});

// Q6 (c): a recipe captured from a COMPOSITE panel window goes through the
// same rebind picker when one of its datasets is missing, and "Apply" opens
// the composite window.
describe("PlotRecipeApplyDialog — composite panel window rebind", () => {
  it("picks a stand-in for a missing dataset and applies a new panel window", async () => {
    reset();
    const d1 = dataset(["2theta", "Intensity", "Ierr"]);
    const d2 = dataset(["2theta", "Intensity", "Ierr"], "d2");
    useApp.setState({ datasets: [d1, d2] });
    const win = useApp.getState().createPanelWindow(["d1", "d2"], "grid");
    const recipeId = await useApp.getState().saveAsPlotRecipe("Pair", "d1", win);
    // d2 is gone; d9 is available as a stand-in.
    useApp.setState({ plotWindows: [], datasets: [d1, dataset(["2theta", "Intensity", "Ierr"], "d9")] });
    await useApp.getState().applyPlotRecipe(recipeId!, "d1");
    render(<PlotRecipeApplyDialog />);

    fireEvent.change(screen.getByRole("combobox", { name: 'Panel 2 dataset ("d2.xy")' }), { target: { value: "d9" } });
    await waitFor(() => expect(useApp.getState().pendingRecipeApplication?.resolution.unmatched).toEqual([]));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(useApp.getState().pendingRecipeApplication).toBeNull());

    const panel = useApp.getState().plotWindows.find((w) => w.kind === "panel")?.panel;
    expect(panel).toEqual({ datasetIds: ["d1", "d9"], layout: "grid" });
  });
});
