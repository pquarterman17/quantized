// UX-F: the residual plots are one click from any Curve Fit tab -- the
// Results tab -- and open by themselves after a fit. uPlot needs matchMedia,
// which jsdom lacks, so this file stubs it locally and replaces the plot grid.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { listFitModels } from "../../../lib/api/curvefit";
import { fitDiagnostics } from "../../../lib/api/fitStats";
import type { DataStruct } from "../../../lib/types";
import { retainFitted } from "../../../store/curveFitSession";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  fitModel: vi.fn(),
}));
vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  listFitModels: vi.fn(),
}));
vi.mock("../../../lib/api/fitStats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/fitStats")>()),
  fitDiagnostics: vi.fn(),
}));
vi.mock("./ResidualPlotGrid", () => ({ default: () => <div data-testid="residual-grid" /> }));

const DATA: DataStruct = { time: [0, 1, 2, 3, 4], values: [[1], [3], [5], [7], [9]], labels: ["y"], units: [""], metadata: {} };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  retainFitted(null, null);
  vi.mocked(listFitModels).mockResolvedValue({
    models: [{ name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] }],
  });
  vi.mocked(fitModel).mockResolvedValue({
    params: [2, 1], errors: [0.1, 0.2], R2: 0.98, RMSE: 0.5, chiSqRed: 0.3, nPoints: 5, nFree: 2,
    yFit: [1, 3, 5, 7, 9], residuals: [0.1, -0.1, 0, 0.1, -0.1],
  });
  vi.mocked(fitDiagnostics).mockResolvedValue({ residuals: { qqX: [0], qqY: [0] } } as unknown as Awaited<ReturnType<typeof fitDiagnostics>>);
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA }],
    activeId: "d1", xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, fitOverlay: null,
    analysisResults: [], curveFitOpen: true, toolWindowLayout: {},
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Curve Fit residual plots (UX-F)", () => {
  it("open by themselves in the Results tab after a fit", async () => {
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Fit" }));
    expect(await screen.findByTestId("residual-grid")).toBeInTheDocument();
    expect(screen.getByText("Residual plots").closest("details")).toHaveAttribute("open");
  });

  it("are one click (the Results tab) from any other tab", async () => {
    render(<CurveFitPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Fit" }));
    await screen.findByTestId("residual-grid");
    // Collapse them, leave for Advanced, come back with one click.
    const details = screen.getByText("Residual plots").closest("details")!;
    const toggled = new Promise((done) => details.addEventListener("toggle", done, { once: true }));
    fireEvent.click(screen.getByText("Residual plots"));
    await act(async () => {
      await toggled;
    });
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("tab", { name: "Results" }));
    expect(screen.getByText("Residual plots").closest("details")).toHaveAttribute("open");
  });
});
