// CurveFitPanel — the lazy fit-statistics sections: Bands and Diagnostics
// appear only after a completed fit, Compare models is always offered, and
// the ODR option only when the dataset has an X-error column.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitModel } from "../../../lib/api";
import { autoGuess, listFitModels } from "../../../lib/api/curvefit";
import { compareModels, fitBands, fitDiagnostics } from "../../../lib/api/fitStats";
import type { Dataset } from "../../../lib/types";
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
vi.mock("../../../lib/api/fitStats", () => ({
  fitBands: vi.fn(),
  fitDiagnostics: vi.fn(),
  compareModels: vi.fn(),
  odrFit: vi.fn(),
}));

const DS: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [[1, 0.1, 3], [2, 0.1, 5], [3, 0.1, 7], [4, 0.1, 9]],
    labels: ["x", "ex", "y"],
    units: ["", "", ""],
    metadata: {},
  },
  errorRoles: [],
};

function withXErr(ds: Dataset): Dataset {
  return { ...ds, errorRoles: [{ channel: 1, target: -1, axis: "x", side: "both" }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listFitModels).mockResolvedValue({
    models: [
      { name: "Linear", category: "polynomial", paramNames: ["m", "b"], nParams: 2, p0: [1, 0], lb: [], ub: [] },
      { name: "Quadratic", category: "polynomial", paramNames: ["a", "b", "c"], nParams: 3, p0: [1, 0, 0], lb: [], ub: [] },
    ],
  });
  vi.mocked(fitModel).mockResolvedValue({
    params: [2, 1],
    errors: [0.1, 0.2],
    covar: [[0.01, 0], [0, 0.04]],
    R2: 0.99,
    RMSE: 0.1,
    chiSqRed: 1.25,
    nPoints: 4,
    nFree: 2,
    yFit: [3, 5, 7, 9],
    residuals: [0, 0, 0, 0],
  });
  vi.mocked(autoGuess).mockResolvedValue({ p0: [1, 0] } as Awaited<ReturnType<typeof autoGuess>>);
  vi.mocked(fitBands).mockImplementation((req) =>
    Promise.resolve({
      yFit: req.x.map((x) => 2 * x + 1),
      ciLo: req.x.map((x) => 2 * x + 0.8),
      ciHi: req.x.map((x) => 2 * x + 1.2),
      piLo: req.x.map((x) => 2 * x),
      piHi: req.x.map((x) => 2 * x + 2),
      level: req.level ?? 0.95,
    }),
  );
  vi.mocked(fitDiagnostics).mockResolvedValue({
    compare: { R2: 0.99, adjR2: 0.985, aic: -12.5, aicc: -0.5, bic: -13.7, rmse: 0.1, n: 4, p: 2 },
    residuals: {
      qqX: [], qqY: [], durbinWatson: 2.1, runsTestZ: 0.3, runsTestP: 0.76, nRuns: 3, skewness: 0.05, kurtosis: -1.2,
    },
  });
  useApp.setState({
    datasets: [DS],
    activeId: "d1",
    xKey: 0,
    yKeys: [2],
    seriesOrder: null,
    errKeys: {},
    fitOverlay: null,
    curveFitOpen: true,
  });
});

async function fit(): Promise<void> {
  await screen.findAllByRole("option", { name: "Quadratic" });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Fit" }));
  });
}

describe("CurveFitPanel — fit statistics sections", () => {
  it("offers Bands and Diagnostics only once a fit completed", async () => {
    render(<CurveFitPanel />);
    await screen.findByText("Compare models");
    expect(screen.queryByText("Bands")).toBeNull();
    expect(screen.queryByText("Diagnostics")).toBeNull();
    await fit();
    expect(await screen.findByText("Bands")).toBeInTheDocument();
    expect(await screen.findByText("Diagnostics")).toBeInTheDocument();
  });

  it("hides Bands again after an auto-guess", async () => {
    render(<CurveFitPanel />);
    await fit();
    await screen.findByText("Bands");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Auto-guess" }));
    });
    expect(screen.queryByText("Bands")).toBeNull();
  });

  it("toggling Bands computes the band and offers to plot it", async () => {
    render(<CurveFitPanel />);
    await fit();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Bands" }));
    expect(await screen.findByRole("button", { name: "Plot with band" })).toBeInTheDocument();
    expect(screen.getByText(/95% CI ±/)).toBeInTheDocument();
    expect(vi.mocked(fitBands).mock.calls[0]![0]).toMatchObject({ model: "Linear", params: [2, 1], dof: 2 });
  });

  it("opening Diagnostics lists AIC/BIC, R², reduced χ² and residual stats", async () => {
    render(<CurveFitPanel />);
    await fit();
    const summary = await screen.findByText("Diagnostics");
    const details = summary.closest("details")!;
    await act(async () => {
      details.open = true;
      fireEvent(details, new Event("toggle"));
    });
    expect(await screen.findByText("reduced χ²")).toBeInTheDocument();
    for (const k of ["AIC", "BIC", "R²", "Durbin–Watson", "skewness"]) {
      expect(screen.getAllByText(k).length).toBeGreaterThan(0);
    }
    expect(vi.mocked(fitDiagnostics).mock.calls[0]![0]).toEqual({ y: [3, 5, 7, 9], residuals: [0, 0, 0, 0], n_params: 2 });
  });

  it("Compare models fits the picked models and shows the table", async () => {
    vi.mocked(compareModels).mockResolvedValue({
      n: 4,
      reference: "Linear",
      results: [
        { name: "Linear", kind: "registry", error: null, k: 2, params: [2, 1], paramNames: ["m", "b"], chiSqRed: 1, R2: 0.99, adjR2: 0.985, aic: -12, aicc: 0, bic: -13, rmse: 0.1, fStat: null, fPvalue: null, dAIC: 0, dAICc: 0, dBIC: 0 },
        { name: "Quadratic", kind: "registry", error: "too few points", k: null, params: null, paramNames: null, chiSqRed: null, R2: null, adjR2: null, aic: null, aicc: null, bic: null, rmse: null, fStat: null, fPvalue: null, dAIC: null, dAICc: null, dBIC: null },
      ],
    });
    render(<CurveFitPanel />);
    await screen.findAllByRole("option", { name: "Quadratic" });
    fireEvent.change(await screen.findByLabelText("Add a model to compare"), { target: { value: "Quadratic" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    });
    const table = await screen.findByRole("table", { name: "Model comparison" });
    expect(table).toHaveTextContent("ref");
    expect(table).toHaveTextContent("too few points");
    expect(vi.mocked(compareModels).mock.calls[0]![0].models).toEqual(["Linear", "Quadratic"]);
  });

  it("offers ODR only when an X-error column is designated", async () => {
    const { unmount } = render(<CurveFitPanel />);
    await screen.findByText("Compare models");
    expect(screen.queryByRole("button", { name: "Fit line (ODR)" })).toBeNull();
    unmount();
    useApp.setState({ datasets: [withXErr(DS)] });
    render(<CurveFitPanel />);
    expect(await screen.findByRole("button", { name: "Fit line (ODR)" })).toBeInTheDocument();
  });
});
