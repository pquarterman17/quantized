// CurveFitPanel — a fit result belongs to the dataset and model it was fit
// for. The hook used to keep the last result across a dataset switch or a
// model pick, so "→ Report" titled and referenced the CURRENT dataset/model
// while shipping the previous one's parameters.

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listFitModels } from "../../../lib/api/curvefit";
import { fitModel, reportEmit } from "../../../lib/api";
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
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10], [20], [30], [40]],
  labels: ["y"],
  units: [""],
  metadata: {},
};

const two = (name: string) => ({ name, category: "x", paramNames: ["a", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({ models: [two("Linear"), two("Exponential")] });
  vi.mocked(fitModel).mockResolvedValue({ params: [10, 0], errors: [0.1, 0.2], R2: 1, RMSE: 0, yFit: [10, 20, 30, 40] });
  vi.mocked(reportEmit).mockResolvedValue({ report: { sheets: [] } } as never);
  useApp.setState({
    datasets: [
      { id: "d1", name: "first.dat", data: DATA },
      { id: "d2", name: "second.dat", data: DATA },
    ],
    activeId: "d1",
    xKey: null,
    yKeys: null,
    seriesOrder: null,
    errKeys: {},
    fitOverlay: null,
    curveFitOpen: true,
  });
});

async function fitFirst(): Promise<void> {
  render(<CurveFitPanel />);
  await within(screen.getByLabelText("Model")).findByRole("option", { name: "Exponential" });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  });
  expect(await screen.findByRole("button", { name: "→ Report" })).toBeInTheDocument();
}

describe("CurveFitPanel — a result follows the dataset and model it was fit for", () => {
  it("does not offer first.dat's fit as a report on second.dat", async () => {
    await fitFirst();
    act(() => useApp.setState({ activeId: "d2" }));
    expect(screen.queryByRole("button", { name: "→ Report" })).toBeNull();
    expect(screen.queryByRole("cell", { name: "R²" })).toBeNull();
  });

  it("does not offer a Linear fit as an Exponential report", async () => {
    await fitFirst();
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "Exponential" } });
    expect(screen.queryByRole("button", { name: "→ Report" })).toBeNull();
    // Picking the fitted model again brings its result back.
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "Linear" } });
    fireEvent.click(screen.getByRole("button", { name: "→ Report" }));
    await act(async () => {});
    expect(vi.mocked(reportEmit).mock.calls[0]![0]).toMatchObject({ model_name: "Linear", title: "Linear fit — first.dat" });
  });

  it("a fit that lands after a dataset switch is not shown for the new dataset", async () => {
    let land: (v: Record<string, unknown>) => void = () => {};
    vi.mocked(fitModel).mockImplementation(() => new Promise((r) => { land = r; }));
    render(<CurveFitPanel />);
    await within(screen.getByLabelText("Model")).findByRole("option", { name: "Exponential" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Fit" }));
    });
    act(() => useApp.setState({ activeId: "d2" }));
    await act(async () => land({ params: [10, 0], errors: [0.1, 0.2], R2: 1, RMSE: 0, yFit: [10, 20, 30, 40] }));
    expect(screen.queryByRole("button", { name: "→ Report" })).toBeNull();
    // The fit is still recorded on the dataset it ran on.
    expect(useApp.getState().datasets.find((d) => d.id === "d1")?.fitSpec).toBeTruthy();
  });
});
