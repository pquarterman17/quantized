// CurveFitPanel — the lazy "Global fit" mode: the toggle swaps the single-fit
// body for the global section (its own chunk), which picks the series, marks
// parameters shared, runs the job and shows shared + per-dataset values.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listFitModels } from "../../../lib/api/curvefit";
import { globalFitJob, type GlobalFitResult } from "../../../lib/api/globalFit";
import { pollJob } from "../../../lib/jobs";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
  fetchBookData: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  listFitModels: vi.fn(),
}));
vi.mock("../../../lib/api/globalFit", () => ({ globalFitJob: vi.fn() }));
vi.mock("../../../lib/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/jobs")>()),
  pollJob: vi.fn(),
  cancelJob: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2],
  values: [
    [1, 2],
    [3, 5],
    [5, 8],
  ],
  labels: ["A", "B"],
  units: ["", ""],
  metadata: {},
};

const FIT: GlobalFitResult = {
  paramNames: ["m", "b"],
  params: [
    [2, 1],
    [3, 1],
  ],
  errors: [
    [0.25, 0.5],
    [0.125, 0.5],
  ],
  shared: [{ name: "b", paramIdx: 1, datasets: [0, 1], value: 1, error: 0.5 }],
  yFit: [
    [1, 3, 5],
    [2, 5, 8],
  ],
  R2: [0.75, 0.5],
  RMSE: [0.1, 0.2],
  chiSqRed: 1.5,
  nTotal: 6,
  nFree: 3,
  exitFlag: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({
    models: [{ name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [null, null], ub: [null, null] }],
  });
  vi.mocked(globalFitJob).mockResolvedValue({ job_id: "j1" });
  vi.mocked(pollJob).mockResolvedValue(FIT);
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: [0, 1],
    seriesOrder: null,
    errKeys: {},
    fitOverlay: null,
    curveFitOpen: true,
  });
});

describe("CurveFitPanel — Global fit mode", () => {
  it("swaps the single-fit body for the global section and back", async () => {
    render(<CurveFitPanel />);
    expect(await screen.findByRole("button", { name: "Auto-guess" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Global fit" }));
    expect(await screen.findByLabelText("Fit across")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Auto-guess" })).toBeNull();
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Global fit" }));
    expect(await screen.findByRole("button", { name: "Auto-guess" })).toBeInTheDocument();
  });

  it("runs a shared-parameter fit and tabulates shared and per-dataset values", async () => {
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Global fit" }));
    // Both plotted channels are pre-picked; share the intercept.
    expect(await screen.findByLabelText("Fit A")).toBeChecked();
    expect(screen.getByLabelText("Fit B")).toBeChecked();
    await waitFor(() => expect(screen.getByLabelText("Share b across all series")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Share b across all series"));
    fireEvent.click(screen.getByRole("button", { name: "Fit globally" }));

    const table = await screen.findByRole("table", { name: "Global fit parameters" });
    const rows = within(table).getAllByRole("row").slice(1).map((r) => r.textContent);
    expect(rows).toEqual(["bshared10.5", "mA20.25", "mB30.125"]);
    expect(vi.mocked(globalFitJob).mock.calls[0]![0].constraints).toEqual([{ param_name: "b", datasets: [0, 1] }]);
    const stats = screen.getByRole("table", { name: "Global fit per series" });
    expect(within(stats).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "→ Report" })).toBeInTheDocument();
    await waitFor(() => expect(useApp.getState().fitOverlay).toEqual({ datasetId: "d1", y: [1, 3, 5] }));
  });

  it("surfaces a refusal to fit a single series", async () => {
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Global fit" }));
    fireEvent.click(await screen.findByLabelText("Fit B"));
    fireEvent.click(screen.getByRole("button", { name: "Fit globally" }));
    expect(await screen.findByText(/at least two series/)).toBeInTheDocument();
    expect(globalFitJob).not.toHaveBeenCalled();
  });
});
