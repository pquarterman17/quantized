// UX audit 8 #5 (lane UX8-D): Curve Fit's range defaults to what the user can
// see. Zoomed in, the fit runs on the visible X range; not zoomed, a
// single-peak model offers "Fit range: drag on plot", and the dragged range is
// what the next fit reads.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { autoGuess, listFitModels } from "../../../lib/api/curvefit";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
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

const X = Array.from({ length: 21 }, (_, i) => 100 + i * 10); // 100..300
const DS: Dataset = {
  id: "d1",
  name: "raman.txt",
  data: { time: X, values: X.map((x) => [Math.exp(-(((x - 200) / 20) ** 2))]), labels: ["I"], units: [""], metadata: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({
    models: [
      { name: "Linear", category: "Linear", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] },
      { name: "Lorentzian", category: "Peak", paramNames: ["A", "x₀", "γ"], nParams: 3, p0: [1, 0, 1], lb: [], ub: [] },
    ],
  });
  vi.mocked(fitModel).mockImplementation(async (req) => ({
    params: [1, 200, 20], errors: [0.1, 1, 1], R2: 0.98, chiSqRed: 1, nPoints: req.x.length, nFree: 3,
    yFit: req.x.map(() => 0), residuals: req.x.map((_, i) => (i % 2 ? 1 : -1) * 0.01 * ((i % 3) + 1)),
  }));
  vi.mocked(autoGuess).mockResolvedValue({ p0: [1, 0] } as Awaited<ReturnType<typeof autoGuess>>);
  useAnalysisSelection.getState().clear();
  useApp.setState({
    datasets: [DS], activeId: "d1", xKey: null, yKeys: [0], seriesOrder: null, errKeys: {},
    fitOverlay: null, curveFitOpen: true, xLim: null, plotTool: "pointer", regionPicked: null,
    qfitRoi: null, integral: null, selection: null,
  });
});

const fittedX = (): number[] => vi.mocked(fitModel).mock.calls.at(-1)![0].x;

async function fit(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  });
}

describe("Curve Fit range (UX8-D)", () => {
  it("fits the whole X range when the plot is not zoomed", async () => {
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: /^Lorentzian/ });
    expect(screen.queryByTestId("cf-fit-range")).toBeNull();
    await fit();
    expect(fittedX()).toEqual(X);
  });

  it("defaults to the visible X range while zoomed in, and follows the zoom until a fit lands", async () => {
    useApp.setState({ xLim: [150, 250] });
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: "Linear" });
    expect(await screen.findByTestId("cf-fit-range")).toHaveTextContent("Fit range 150 – 250 (visible x range)");
    act(() => useApp.setState({ xLim: [null, 180] })); // before a fit: follows
    expect(screen.getByTestId("cf-fit-range")).toHaveTextContent("Fit range 100 – 180 (visible x range)");
    act(() => useApp.setState({ xLim: [150, 250] }));
    await fit();
    expect(fittedX()).toEqual(X.filter((x) => x >= 150 && x <= 250));

    // Zooming to LOOK at the fit changes neither its range nor its freshness.
    act(() => useApp.setState({ xLim: [null, 180] }));
    expect(screen.getByTestId("cf-fit-range")).toHaveTextContent("Fit range 150 – 250 (visible x range)");
    expect(screen.queryByText(/Inputs changed/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use visible range" })); // ...unless asked
    expect(screen.getByTestId("cf-fit-range")).toHaveTextContent("Fit range 100 – 180 (visible x range)");
    act(() => useApp.setState({ xLim: null })); // no fit current now: the whole range again
    expect(screen.queryByTestId("cf-fit-range")).toBeNull();
    await fit();
    expect(fittedX()).toEqual(X);
  });

  it("offers a drag for a single-peak model; the dragged range is fitted until Whole range", async () => {
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: /^Lorentzian/ });
    expect(screen.queryByRole("button", { name: "Fit range: drag on plot" })).toBeNull(); // Linear
    fireEvent.change(screen.getByRole("combobox", { name: /model/i }), { target: { value: "Lorentzian" } });
    fireEvent.click(await screen.findByRole("button", { name: "Fit range: drag on plot" }));
    expect(useApp.getState().plotTool).toBe("region");
    expect(screen.getByText("Drag across the peak on the plot…")).toBeInTheDocument();

    // The plot's rubber-band (usePlotStageActions' onRegionSelect).
    act(() => {
      useApp.getState().setRegionPicked({ x: [240, 160] });
      useApp.getState().setPlotTool("zoom");
    });
    expect(useApp.getState().regionPicked).toBeNull(); // consumed here
    expect(screen.getByTestId("cf-fit-range")).toHaveTextContent("Fit range 160 – 240 (dragged)");
    await fit();
    expect(fittedX()).toEqual(X.filter((x) => x >= 160 && x <= 240));

    fireEvent.click(screen.getByRole("button", { name: "Whole range" }));
    expect(screen.queryByTestId("cf-fit-range")).toBeNull();
    await fit();
    expect(fittedX()).toEqual(X);
  });

  it("Cancel goes back to the tool the user had and changes nothing", async () => {
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: /^Lorentzian/ });
    fireEvent.change(screen.getByRole("combobox", { name: /model/i }), { target: { value: "Lorentzian" } });
    fireEvent.click(await screen.findByRole("button", { name: "Fit range: drag on plot" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useApp.getState().plotTool).toBe("pointer");
    expect(screen.getByRole("button", { name: "Fit range: drag on plot" })).toBeInTheDocument();
  });
});
