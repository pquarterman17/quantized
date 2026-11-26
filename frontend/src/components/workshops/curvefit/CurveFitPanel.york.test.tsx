// Acceptance #1046: the panel header read "Not fitted yet" next to a finished York
// (or ODR) result, because its status looked only at the model fit. Driven through the
// real panel: the Advanced tab's line fit runs, the header must say a fit exists.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listFitModels } from "../../../lib/api/curvefit";
import { odrFit, yorkFit, type OdrResult, type YorkResult } from "../../../lib/api/fitStats";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import CurveFitPanel from "./CurveFitPanel";

vi.mock("../../../lib/api/curvefit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/curvefit")>()),
  autoGuess: vi.fn(),
  listFitModels: vi.fn(),
  bootstrapFit: vi.fn(),
}));
vi.mock("../../../lib/api/fitStats", () => ({
  fitBands: vi.fn(), fitDiagnostics: vi.fn(), compareModels: vi.fn(), odrFit: vi.fn(), yorkFit: vi.fn(),
}));

const DS: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [0, 1, 2],
    values: [[1, 0.1, 3, 0.3], [2, 0.1, 5, 0.2], [3, 0.2, 7, 0.4]],
    labels: ["x", "ex", "y", "ey"],
    units: ["", "", "", ""],
    metadata: {},
  },
  errorRoles: [{ channel: 1, target: -1, axis: "x", side: "both" }],
};
const DEMING: OdrResult = { slope: 2, intercept: 1, slopeErr: 0.1, interceptErr: 0.2, lambda: 1, rss: 0.1, rmse: 0.1, n: 3 };
const YORK: YorkResult = {
  slope: 2.5, intercept: 0.5, slopeErr: 0.05, interceptErr: 0.07, slopeErrScaled: 0.06, interceptErrScaled: 0.08,
  chiSq: 1.2, mswd: 1.2, dof: 1, n: 3, nIter: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(listFitModels).mockResolvedValue({
    models: [{ name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] }],
  });
  vi.mocked(odrFit).mockResolvedValue(DEMING);
  vi.mocked(yorkFit).mockResolvedValue(YORK);
  useApp.setState({
    datasets: [DS], activeId: "d1", xKey: 0, yKeys: [2], seriesOrder: null, errKeys: { 2: 3 },
    fitOverlay: null, analysisResults: [], curveFitOpen: true, toolWindowLayout: {},
  });
});

async function openLineFit(): Promise<void> {
  render(<CurveFitPanel />);
  await screen.findByRole("option", { name: "Linear" });
  expect(screen.getByText("Not fitted yet")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("tab", { name: "Advanced" }));
}

describe("CurveFitPanel header with a line fit on errors in x and y", () => {
  it("names a York result instead of reading 'Not fitted yet'", async () => {
    await openLineFit();
    fireEvent.change(await screen.findByRole("combobox", { name: "Weighting" }), { target: { value: "york" } });
    fireEvent.click(screen.getByRole("button", { name: "Fit line (York)" }));
    await screen.findByText("reduced χ² (MSWD)");
    expect(screen.queryByText("Not fitted yet")).toBeNull();
    expect(screen.getByText(/York line fit/)).toBeInTheDocument();
  });

  it("names a Deming result the same way", async () => {
    await openLineFit();
    fireEvent.click(await screen.findByRole("button", { name: "Fit line (ODR)" }));
    await screen.findByText("slope");
    expect(screen.queryByText("Not fitted yet")).toBeNull();
    expect(screen.getByText(/ODR line fit/)).toBeInTheDocument();
  });

  it("says the line fit is out of date once its inputs change", async () => {
    await openLineFit();
    fireEvent.click(await screen.findByRole("button", { name: "Fit line (ODR)" }));
    await screen.findByText("slope");
    useApp.setState({ errKeys: {} });
    expect(await screen.findByText(/ODR line fit is out of date/)).toBeInTheDocument();
  });
});
