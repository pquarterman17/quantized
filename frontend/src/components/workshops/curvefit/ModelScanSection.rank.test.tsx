// Rank all models through the real Curve Fit window: choose a category on the
// Advanced tab, run the ranking, read the table, press "Use this model", and
// the Setup tab's model picker holds that model.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanEntry } from "../../../lib/api/curvefit";
import { listFitModels } from "../../../lib/api/curvefit";
import { scanFitModelsJob } from "../../../lib/fitscan";
import * as jobs from "../../../lib/jobs";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
}));
vi.mock("../../../lib/fitscan", () => ({ scanFitModelsJob: vi.fn() }));
vi.mock("../../../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/jobs")>()),
  pollJob: vi.fn(),
  cancelJob: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [3], [9], [3], [1], [0]],
  labels: ["y"], units: [""], metadata: {},
};
const row = (name: string, over: Partial<ScanEntry>): ScanEntry => ({
  name, kind: "registry", error: null, k: 3, params: [1], paramNames: ["a"], R2: 0.99, RMSE: 0.1, AIC: -10, AICc: -9,
  deltaAICc: 0, weight: 0.5, adjR2: 0.98, chiSqRed: 0.02, BIC: -8, converged: true, ...over,
});
const model = (name: string, category: string) => ({ name, category, paramNames: ["a"], nParams: 1, p0: [1], lb: [], ub: [] });

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({
    models: [model("Linear", "Linear"), model("Gaussian", "Peak Functions"), model("Lorentzian", "Peak Functions")],
  });
  vi.mocked(scanFitModelsJob).mockResolvedValue({ job_id: "j1" });
  vi.mocked(jobs.pollJob).mockResolvedValue({
    results: [
      row("Lorentzian", { converged: false, AICc: -12 }),
      row("Gaussian", {}),
      { ...row("Broken", {}), error: "model undefined at the start values", converged: null },
    ],
  });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", xKey: null, yKeys: [0], seriesOrder: null,
    errKeys: {}, fitOverlay: null, analysisResults: [], curveFitOpen: true, toolWindowLayout: {},
  });
});

describe("Rank all models from the Curve Fit window", () => {
  it("ranks one category, shows the table, and Use this model opens Curve Fit with that model", async () => {
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByRole("tab", { name: "Advanced" }));
    fireEvent.change(await screen.findByLabelText("Category to rank"), { target: { value: "Peak Functions" } });
    expect(screen.getByText("2 of 2 models ticked")).toBeInTheDocument();
    // unticking Lorentzian leaves exactly Gaussian to fit
    fireEvent.click(screen.getByLabelText("Rank Lorentzian"));
    fireEvent.click(screen.getByRole("button", { name: "Rank models" }));

    const table = await screen.findByRole("table", { name: "Model ranking" });
    expect(scanFitModelsJob).toHaveBeenCalledWith({ x: [0, 1, 2, 3, 4, 5], y: [1, 3, 9, 3, 1, 0], models: ["Gaussian"] });
    // best = the first CONVERGED row, not the lower-AICc unconverged one
    expect(within(within(table).getByText("Gaussian").closest("tr")!).getByText("best")).toBeInTheDocument();
    expect(within(table).queryAllByText("best")).toHaveLength(1);
    expect(screen.getByText("model undefined at the start values")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use this model" }));
    fireEvent.click(screen.getByRole("tab", { name: "Setup" }));
    const pickers = await screen.findAllByRole("combobox");
    expect(pickers.some((p) => (p as HTMLSelectElement).value === "Gaussian")).toBe(true);
  });

  it("with no category chosen the default set is requested", async () => {
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByRole("tab", { name: "Advanced" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rank models" }));
    await screen.findByRole("table", { name: "Model ranking" });
    expect(scanFitModelsJob).toHaveBeenCalledWith({ x: [0, 1, 2, 3, 4, 5], y: [1, 3, 9, 3, 1, 0] });
  });
});
