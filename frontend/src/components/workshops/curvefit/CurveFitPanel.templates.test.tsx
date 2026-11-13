// Fit templates in the Curve Fit panel (audit #15): Save as template captures
// model, weighting, the start/bounds/hold table and the X range; applying one
// (explicitly — nothing auto-applies) loads them into the panel for another
// dataset, the user then presses Fit.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import { fitTemplateOf } from "../../../lib/fitTemplates";
import { loadTemplates } from "../../../lib/template";
import type { DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { askConfirm } from "../../../store/confirmDialog";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";
import { retainFitted } from "./curveFitSession";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  listFitModels: vi.fn(),
}));

vi.mock("../../../store/confirmDialog", () => ({ askConfirm: vi.fn(async () => true) }));

const DATA: DataStruct = { time: [0, 1, 2, 3], values: [[1, 0.1], [3, 0.1], [5, 0.1], [7, 0.1]], labels: ["y", "w"], units: ["", ""], metadata: {} };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  retainFitted(null, null);
  vi.mocked(listFitModels).mockResolvedValue({
    models: [
      { name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] },
      { name: "Quadratic", category: "polynomial", paramNames: ["a", "b", "c"], nParams: 3, p0: [1, 1, 0], lb: [], ub: [] },
    ],
  });
  vi.mocked(fitModel).mockResolvedValue({ params: [1, 1, 1], errors: [0, 0, 0], R2: 1 });
  const datasets = [{ id: "d1", name: "run.dat", data: DATA }];
  useApp.setState({ datasets, activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, fitOverlay: null, curveFitOpen: true });
  useAnalysisSelection.setState({
    toolId: "curvefit",
    selection: captureAnalysisSelection({ datasets, activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, selection: null, range: null }, "library"),
  });
});

describe("CurveFitPanel — fit templates", () => {
  it("saves the panel's settings and applies them back, never on its own", async () => {
    render(<CurveFitPanel />);
    fireEvent.change(await screen.findByLabelText("Model"), { target: { value: "Quadratic" } });
    fireEvent.change(screen.getByLabelText("Weighting"), { target: { value: "manual" } });
    await waitFor(() => expect(screen.getByLabelText("Weighting")).toHaveValue("manual"));
    fireEvent.click(await screen.findByText("Templates"));
    fireEvent.change(screen.getByLabelText("New fit template name"), { target: { value: "quad" } });
    fireEvent.click(screen.getByRole("button", { name: "Save as template" }));
    await waitFor(() => expect(loadTemplates()).toHaveLength(1));
    const saved = fitTemplateOf(loadTemplates()[0]!);
    expect(saved).toMatchObject({ model: "Quadratic", weight: "manual" });
    expect(saved!.rows.map((r) => r.name)).toEqual(["a", "b", "c"]);

    // Change everything, then apply: the template's settings come back.
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "Linear" } });
    fireEvent.change(screen.getByLabelText("Weighting"), { target: { value: "none" } });
    expect(fitModel).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Saved fit template"), { target: { value: "quad" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply template" }));
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("Quadratic"));
    expect(screen.getByLabelText("Weighting")).toHaveValue("manual");
    expect(fitModel).not.toHaveBeenCalled(); // applied, not run
  });

  it("applies a template's X range to the analysis selection", async () => {
    const { toFitTemplate } = await import("../../../lib/fitTemplates");
    const { saveTemplate } = await import("../../../lib/template");
    saveTemplate(toFitTemplate("ranged", { version: 1, model: "Linear", weight: "none", rows: [], range: { lo: 1, hi: 2 } }));
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByText("Templates"));
    fireEvent.change(screen.getByLabelText("Saved fit template"), { target: { value: "ranged" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply template" }));
    await waitFor(() =>
      expect(useAnalysisSelection.getState().selection?.items[0]?.range).toEqual({ lo: 1, hi: 2, source: "manual" }),
    );
  });

  it("deletes a saved template after a confirmation, and not when it is declined", async () => {
    const { toFitTemplate } = await import("../../../lib/fitTemplates");
    const { saveTemplate } = await import("../../../lib/template");
    saveTemplate(toFitTemplate("old", { version: 1, model: "Linear", weight: "none", rows: [] }));
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByText("Templates"));
    // Nothing picked: there is nothing to delete.
    expect(screen.getByRole("button", { name: "Delete template" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Saved fit template"), { target: { value: "old" } });
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    await waitFor(() => expect(askConfirm).toHaveBeenCalledTimes(1));
    expect(loadTemplates()).toHaveLength(1);
    vi.mocked(askConfirm).mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    await waitFor(() => expect(loadTemplates()).toHaveLength(0));
    expect(await screen.findByText("No fit templates yet.")).toBeInTheDocument();
    expect(useApp.getState().status).toBe('deleted fit template "old"');
  });

  it("refuses a template whose model this build does not have, changing nothing", async () => {
    const { toFitTemplate } = await import("../../../lib/fitTemplates");
    const { saveTemplate } = await import("../../../lib/template");
    saveTemplate(toFitTemplate("plugin", { version: 1, model: "Langevin", weight: "poisson", rows: [] }));
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByText("Templates"));
    fireEvent.change(screen.getByLabelText("Saved fit template"), { target: { value: "plugin" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply template" }));
    expect(screen.getByLabelText("Model")).toHaveValue("Linear");
    expect(screen.getByLabelText("Weighting")).toHaveValue("none");
  });
});

