// Fit templates in the Curve Fit panel (audit #15), through the preset bar
// (PRESET_BAR_CONTRACT slice P2): saving captures
// model, weighting, the start/bounds/hold table and the X range; applying one
// (explicitly — nothing auto-applies) loads them into the panel for another
// dataset, the user then presses Fit.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { lastUsedSlot, readLastUsed } from "../../../lib/presetLastUsed";
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
import { retainFitted } from "../../../store/curveFitSession";

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
  lastUsedSlot.reset();
  localStorage.clear(); // the picker lists recently picked models twice (Recent group)
  vi.clearAllMocks();
  localStorage.clear();
  retainFitted(null, null);
  // A slow registry on EVERY test: forces the load-dependent ordering (the
  // panel is interactive before the models arrive) instead of hoping for it.
  vi.mocked(listFitModels).mockImplementation(async () => { await new Promise((r) => setTimeout(r, 50)); return {
    models: [
      { name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] },
      { name: "Quadratic", category: "polynomial", paramNames: ["a", "b", "c"], nParams: 3, p0: [1, 1, 0], lb: [], ub: [] },
    ],
  }; });
  vi.mocked(fitModel).mockResolvedValue({ params: [1, 1, 1], errors: [0, 0, 0], R2: 1 });
  const datasets = [{ id: "d1", name: "run.dat", data: DATA }];
  useApp.setState({ datasets, activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, fitOverlay: null, curveFitOpen: true });
  useAnalysisSelection.setState({
    toolId: "curvefit",
    selection: captureAnalysisSelection({ datasets, activeId: "d1", selectedIds: ["d1"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, selection: null, range: null }, "library"),
  });
});

// The Model select renders BEFORE the model registry resolves (listFitModels
// is async), so its label being findable says nothing about the models being
// loaded. Wait on the STATE that matters: the registry's options are present.
// Without this, under load the first gesture lands on an empty registry and
// every save/apply below silently does nothing.
async function modelsLoaded(): Promise<HTMLElement> {
  const select = await screen.findByLabelText("Model");
  await within(select).findByRole("option", { name: "Quadratic" });
  return select;
}

const bar = () => screen.findByRole("region", { name: "Curve Fit presets" });
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const status = () => within(screen.getByRole("region", { name: "Curve Fit presets" })).getByRole("status").textContent ?? "";

async function saveAs(name: string) {
  await bar();
  press("Save as…");
  fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: name } });
  press("Save");
}

describe("CurveFitPanel — fit templates through the preset bar", () => {
  it("saves the panel's settings as a fit template and applies them back, never on its own", async () => {
    render(<CurveFitPanel />);
    fireEvent.change(await modelsLoaded(), { target: { value: "Quadratic" } });
    fireEvent.change(screen.getByLabelText("Weighting"), { target: { value: "manual" } });
    await waitFor(() => expect(screen.getByLabelText("Weighting")).toHaveValue("manual"));
    await saveAs("quad");
    await waitFor(() => expect(loadTemplates()).toHaveLength(1));
    // The old template code reads what the bar wrote.
    const saved = fitTemplateOf(loadTemplates()[0]!);
    expect(saved).toMatchObject({ model: "Quadratic", weight: "manual" });
    expect(saved!.rows.map((r) => r.name)).toEqual(["a", "b", "c"]);
    // Untouched starts are saved blank (auto), so the template guesses them
    // from the data it is applied to, never the seeded registry default.
    expect(saved!.rows.map((r) => r.start)).toEqual(["", "", ""]);
    expect(loadTemplates()[0]!.name).toBe("quad");

    // Change everything, then apply: the template's settings come back.
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "Linear" } });
    fireEvent.change(screen.getByLabelText("Weighting"), { target: { value: "none" } });
    expect(fitModel).not.toHaveBeenCalled();
    fireEvent.change(select(), { target: { value: "quad" } });
    press("Apply");
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("Quadratic"));
    expect(screen.getByLabelText("Weighting")).toHaveValue("manual");
    expect(fitModel).not.toHaveBeenCalled(); // applied, not run
    expect(readLastUsed("curvefit")).toBeNull(); // Apply is not a run
  });

  it("lists a template the old section saved, and reading it rewrites nothing", async () => {
    const { toFitTemplate } = await import("../../../lib/fitTemplates");
    const { saveTemplate } = await import("../../../lib/template");
    const rows = [{ name: "a", start: "2", min: "", max: "5", fixed: true }, { name: "b", start: "", min: "", max: "", fixed: false }, { name: "c", start: "", min: "", max: "", fixed: false }];
    saveTemplate(toFitTemplate("legacy", { version: 1, model: "Quadratic", weight: "poisson", scaleErrors: false, rows, range: { lo: 1, hi: 2 } }));
    const before = localStorage.getItem("qz.analysisTemplates");
    render(<CurveFitPanel />);
    await modelsLoaded();
    await bar();
    expect(within(select()).getByRole("option", { name: "legacy" })).toBeInTheDocument();
    fireEvent.change(select(), { target: { value: "legacy" } });
    press("Apply");
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("Quadratic"));
    expect(localStorage.getItem("qz.analysisTemplates")).toBe(before);
  });

  it("saves and applies direct weighting with its column and the error-scaling switch", async () => {
    render(<CurveFitPanel />);
    fireEvent.change(await modelsLoaded(), { target: { value: "Quadratic" } });
    fireEvent.change(screen.getByLabelText("Weighting"), { target: { value: "direct" } });
    await waitFor(() => expect(screen.getByLabelText("Weighting")).toHaveValue("direct"));
    fireEvent.change(screen.getByLabelText("Weight column"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Scale errors/ }));
    await saveAs("w");
    await waitFor(() => expect(loadTemplates()).toHaveLength(1));
    expect(fitTemplateOf(loadTemplates()[0]!)).toMatchObject({ weight: "direct", manualLabel: "w", scaleErrors: false });

    fireEvent.change(screen.getByLabelText("Weighting"), { target: { value: "none" } });
    fireEvent.change(select(), { target: { value: "w" } });
    press("Apply");
    await waitFor(() => expect(screen.getByLabelText("Weighting")).toHaveValue("direct"));
    expect(screen.getByRole("checkbox", { name: /Scale errors/ })).not.toBeChecked();
    expect(screen.getByLabelText("Weight column")).toHaveValue("1");
  });

  it("applies a template's X range to the analysis selection", async () => {
    const { toFitTemplate } = await import("../../../lib/fitTemplates");
    const { saveTemplate } = await import("../../../lib/template");
    saveTemplate(toFitTemplate("ranged", { version: 1, model: "Linear", weight: "none", rows: [], range: { lo: 1, hi: 2 } }));
    render(<CurveFitPanel />);
    await modelsLoaded();
    await bar();
    fireEvent.change(select(), { target: { value: "ranged" } });
    press("Apply");
    await waitFor(() =>
      expect(useAnalysisSelection.getState().selection?.items[0]?.range).toEqual({ lo: 1, hi: 2, source: "manual" }),
    );
  });

  it("lists a missing error column as skipped, by name, and never drops it silently", async () => {
    const { toFitTemplate } = await import("../../../lib/fitTemplates");
    const { saveTemplate } = await import("../../../lib/template");
    saveTemplate(toFitTemplate("needs-err", { version: 1, model: "Quadratic", weight: "manual", manualLabel: "sigma_y", rows: [] }));
    render(<CurveFitPanel />);
    await modelsLoaded();
    await bar();
    fireEvent.change(select(), { target: { value: "needs-err" } });
    press("Apply");
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("Quadratic"));
    expect(status()).toContain("manualLabel skipped (column 'sigma_y' is not on this sheet");
    expect(screen.getByLabelText("Weighting")).toHaveValue("manual");
    expect(screen.getByLabelText("Manual error column")).toHaveValue("");
    expect(fitModel).not.toHaveBeenCalled();
  });

  it("a column the sheet has is applied and nothing is skipped", async () => {
    const { toFitTemplate } = await import("../../../lib/fitTemplates");
    const { saveTemplate } = await import("../../../lib/template");
    saveTemplate(toFitTemplate("has-w", { version: 1, model: "Quadratic", weight: "manual", manualLabel: "w", rows: [] }));
    render(<CurveFitPanel />);
    await modelsLoaded();
    await bar();
    fireEvent.change(select(), { target: { value: "has-w" } });
    press("Apply");
    await waitFor(() => expect(screen.getByLabelText("Manual error column")).toHaveValue("1"));
    expect(status()).not.toContain("skipped");
  });

  it("writes last used after a successful fit", async () => {
    render(<CurveFitPanel />);
    fireEvent.change(await modelsLoaded(), { target: { value: "Quadratic" } });
    fireEvent.click(await screen.findByRole("button", { name: "Fit" }));
    await waitFor(() => expect(readLastUsed("curvefit")?.settings).toMatchObject({ model: "Quadratic", weight: "none" }));
  });

  it("does not write last used when the fit fails", async () => {
    vi.mocked(fitModel).mockRejectedValue(new Error("boom"));
    render(<CurveFitPanel />);
    await modelsLoaded();
    fireEvent.click(await screen.findByRole("button", { name: "Fit" }));
    await screen.findByText(/boom/);
    expect(readLastUsed("curvefit")).toBeNull();
  });

  it("deletes a saved template after a confirmation, and not when it is declined", async () => {
    const { toFitTemplate } = await import("../../../lib/fitTemplates");
    const { saveTemplate } = await import("../../../lib/template");
    saveTemplate(toFitTemplate("old", { version: 1, model: "Linear", weight: "none", rows: [] }));
    render(<CurveFitPanel />);
    await modelsLoaded();
    await bar();
    expect(screen.getByRole("button", { name: "Delete…" })).toBeDisabled(); // nothing picked
    fireEvent.change(select(), { target: { value: "old" } });
    vi.mocked(askConfirm).mockResolvedValueOnce(false);
    await act(async () => {
      press("Delete…");
      await Promise.resolve();
    });
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(loadTemplates()).toHaveLength(1);
    vi.mocked(askConfirm).mockResolvedValueOnce(true);
    press("Delete…");
    await waitFor(() => expect(loadTemplates()).toHaveLength(0));
  });

  it("renames a template, keeping its settings", async () => {
    const { toFitTemplate } = await import("../../../lib/fitTemplates");
    const { saveTemplate } = await import("../../../lib/template");
    saveTemplate(toFitTemplate("before", { version: 1, model: "Quadratic", weight: "none", rows: [] }));
    render(<CurveFitPanel />);
    await modelsLoaded();
    await bar();
    fireEvent.change(select(), { target: { value: "before" } });
    press("Rename…");
    fireEvent.change(screen.getByLabelText("New preset name"), { target: { value: "after" } });
    press("Save");
    await waitFor(() => expect(loadTemplates().map((t) => t.name)).toEqual(["after"]));
    expect(fitTemplateOf(loadTemplates()[0]!)).toMatchObject({ model: "Quadratic" });
  });

  it("refuses a template whose model this build does not have, changing nothing", async () => {
    const { toFitTemplate } = await import("../../../lib/fitTemplates");
    const { saveTemplate } = await import("../../../lib/template");
    saveTemplate(toFitTemplate("plugin", { version: 1, model: "Langevin", weight: "poisson", rows: [] }));
    render(<CurveFitPanel />);
    await modelsLoaded();
    await bar();
    fireEvent.change(select(), { target: { value: "plugin" } });
    press("Apply");
    expect(screen.getByLabelText("Model")).toHaveValue("Linear");
    expect(screen.getByLabelText("Weighting")).toHaveValue("none");
    expect(status()).toContain('"Langevin"');
  });
});
