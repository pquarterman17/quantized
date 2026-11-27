// Acceptance 6 C3, through the real Curve Fit panel and preset bar: Apply on a
// sheet that lacks the preset's error column is not "(edited)", the skipped
// item is named for the user ("manual error column"), and Save says so on the
// app status line.

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

const bar = () => screen.findByRole("region", { name: "Curve Fit presets" });
const select = () => screen.getByRole("combobox", { name: "Preset" }) as HTMLSelectElement;
async function modelsLoaded(): Promise<HTMLElement> {
  const select = await screen.findByLabelText("Model");
  await within(select).findByRole("option", { name: "Quadratic" });
  return select;
}

const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const source = () => screen.getByText(/^Settings: /).textContent ?? "";
const barStatus = () => within(screen.getByRole("region", { name: "Curve Fit presets" })).getByRole("status").textContent ?? "";

describe("Curve Fit preset bar, acceptance 6 C3", () => {
  it("Save says so on the app status line", async () => {
    useApp.setState({ status: "imported 1 file" });
    render(<CurveFitPanel />);
    await modelsLoaded();
    await screen.findByRole("region", { name: "Curve Fit presets" });
    press("Save as…");
    fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "quad" } });
    press("Save");
    await waitFor(() => expect(useApp.getState().status).toBe("Saved preset 'quad'"));
    expect(barStatus()).toBe("Saved preset 'quad'");
  });

  it("a preset whose error column is missing applies without (edited), naming the skip for the user", async () => {
    render(<CurveFitPanel />);
    fireEvent.change(await modelsLoaded(), { target: { value: "Quadratic" } });
    fireEvent.change(screen.getByLabelText("Weighting"), { target: { value: "manual" } });
    fireEvent.change(await screen.findByLabelText("Manual error column"), { target: { value: "1" } });
    press("Save as…");
    fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "needs-w" } });
    press("Save");
    await waitFor(() => expect(barStatus()).toBe("Saved preset 'needs-w'"));
    // The same sheet, its "w" column renamed: the preset's column is gone.
    act(() => useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: { ...DATA, labels: ["y", "v"] } }] }));
    fireEvent.change(screen.getByLabelText("Weighting"), { target: { value: "none" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Preset" }), { target: { value: "needs-w" } });
    press("Apply");
    await waitFor(() => expect(barStatus()).toContain("manual error column skipped (column 'w' is not on this sheet"));
    expect(barStatus()).not.toContain("manualLabel");
    expect(source()).toBe("Settings: Preset 'needs-w'");
  });

  it("a preset saved from the panel applies on a fresh sheet without (edited); a later edit shows it", async () => {
    render(<CurveFitPanel />);
    fireEvent.change(await modelsLoaded(), { target: { value: "Quadratic" } });
    await screen.findByRole("region", { name: "Curve Fit presets" });
    press("Save as…");
    fireEvent.change(screen.getByLabelText("Preset name"), { target: { value: "quad" } });
    press("Save");
    await waitFor(() => expect(barStatus()).toBe("Saved preset 'quad'"));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "Linear" } });
    press("Apply");
    await waitFor(() => expect(screen.getByLabelText("Model")).toHaveValue("Quadratic"));
    await waitFor(() => expect(source()).toBe("Settings: Preset 'quad'"));
    fireEvent.change(screen.getByLabelText("Weighting"), { target: { value: "poisson" } });
    await waitFor(() => expect(source()).toBe("Settings: Preset 'quad' (edited)"));
  });
});
