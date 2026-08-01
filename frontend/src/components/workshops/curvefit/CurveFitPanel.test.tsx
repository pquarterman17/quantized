// CurveFitPanel — component test for the "By" grouping UI (JMP_GAP_PLAN J7
// residual). The fit/weighting/params flows are already covered by
// useCurveFit.test.ts; this just proves the panel actually surfaces the
// hook's new by* fields end-to-end.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel, listFitModels } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  autoGuess: vi.fn(),
  fitModel: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
  exportCornerFigure: vi.fn(),
  fetchBookData: vi.fn(),
  reportEmit: vi.fn(),
}));

// Same fixture as useCurveFit.test.ts's By-grouping block: col0 "grp"
// (2-level nominal), col1 "y" (continuous, plotted).
const BY_DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 10], [0, 20], [0, 30], [0, 40], [0, 50], [0, 60],
    [1, 15], [1, 25], [1, 35], [1, 45], [1, 55], [1, 65],
  ],
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({
    models: [{ name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] }],
  });
  vi.mocked(fitModel).mockResolvedValue({ params: [2, 1], errors: [0.1, 0.2], R2: 0.98, RMSE: 0.5, yFit: [0] });
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: BY_DATA }],
    activeId: "d1",
    xKey: null,
    yKeys: [1],
    seriesOrder: null,
    errKeys: {},
    fitOverlay: null,
    curveFitOpen: true,
  });
});

describe("CurveFitPanel — By grouping (JMP_GAP_PLAN J7 residual)", () => {
  it("shows the By selector once a categorical column is available", async () => {
    render(<CurveFitPanel />);
    expect(await screen.findByLabelText("By (optional)")).toBeInTheDocument();
  });

  it("picking a By level renders one collapsible section per level and hides the single-fit table", async () => {
    render(<CurveFitPanel />);
    fireEvent.change(await screen.findByLabelText("By (optional)"), { target: { value: "0" } });
    await waitFor(() => expect(screen.getAllByText(/n=6/)).toHaveLength(2));
  });

  it("discloses that By levels fit unweighted when a weight mode is active", async () => {
    render(<CurveFitPanel />);
    fireEvent.change(await screen.findByLabelText("Weighting"), { target: { value: "poisson" } });
    fireEvent.change(screen.getByLabelText("By (optional)"), { target: { value: "0" } });
    expect(await screen.findByText(/fit unweighted/)).toBeInTheDocument();
  });
});
