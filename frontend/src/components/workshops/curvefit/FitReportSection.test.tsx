// The Fit report section (audit #6): opening it posts THIS fit (params,
// errors, covar, the fitted y and residuals, the weighting dy and the level)
// to /api/fitting/report; a new level re-asks; Copy writes TSV and Save CSV
// writes the same tables.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitReport, type FitReportResult } from "../../../lib/api/fitReport";
import { copyText } from "../../../lib/clipboard";
import { saveBlob } from "../../../lib/download";
import { useApp } from "../../../store/useApp";
import { reportPrefs } from "../../../store/curveFitSession";
import FitReportSection from "./FitReportSection";

vi.mock("../../../lib/api/fitReport", () => ({ fitReport: vi.fn() }));
vi.mock("../../../lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));
vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));

const REP: FitReportResult = {
  level: 0.95,
  parameters: [{ value: 2, error: 0.1, t: 20, prob: 1e-9, lcl: 1.8, ucl: 2.2 }],
  anova: [
    { source: "Regression", df: 1, ss: 10, ms: 10, f: 100, prob: 1e-6 },
    { source: "Residual", df: 3, ss: 0.3, ms: 0.1, f: null, prob: null },
    { source: "Uncorrected Total", df: 4, ss: 10.3, ms: null, f: null, prob: null },
    { source: "Corrected Total", df: 3, ss: 5, ms: null, f: null, prob: null },
  ],
  covariance: [[0.01]],
  correlation: [[1]],
  stats: { n: 4, dof: 3, rss: 0.3, reducedChiSq: 0.1, R2: 0.94, adjR2: 0.92, rootMSE: 0.316 },
};

const RESULT = { params: [2], errors: [0.1], covar: [[0.01]], residuals: [0.1, -0.1, 0.2, -0.2], nFree: 1 };
const FIT = { x: [0, 1, 2, 3], y: [1, 2, 3, 4], xKey: null, yKey: 0, dy: [0.5, 0.5, 0.5, 0.5] };

beforeEach(() => {
  vi.clearAllMocks();
  reportPrefs.level = 0.95;
  vi.mocked(fitReport).mockImplementation(async (req) => ({ ...REP, level: req.level ?? 0.95 }));
});

function open() {
  render(<FitReportSection result={RESULT} fitData={FIT} paramNames={["A"]} fileStem="run-Linear" />);
  fireEvent.click(screen.getByText("Fit report"));
}

describe("FitReportSection", () => {
  it("posts this fit, with its weighting, and shows every table", async () => {
    open();
    expect(await screen.findByText("ANOVA")).toBeInTheDocument();
    const req = vi.mocked(fitReport).mock.calls[0]![0];
    expect(req).toMatchObject({ params: [2], errors: [0.1], y: [1, 2, 3, 4], n_free: 1, dy: [0.5, 0.5, 0.5, 0.5], level: 0.95 });
    expect(screen.getByText("Statistics (weighted)")).toBeInTheDocument();
    expect(screen.getByText("Correlation matrix")).toBeInTheDocument();
    expect(screen.getByText("Prob>|t|")).toBeInTheDocument();
  });

  it("re-asks at the chosen confidence level", async () => {
    open();
    await screen.findByText("ANOVA");
    fireEvent.change(screen.getByLabelText("Parameter confidence level"), { target: { value: "0.99" } });
    await waitFor(() => expect(vi.mocked(fitReport).mock.calls.at(-1)![0].level).toBe(0.99));
    expect(await screen.findByText("LCL (99%)")).toBeInTheDocument();
    // The level is the session's, so "→ Report" emits the same limits
    // (it used to be hardcoded to 95% whatever the panel showed).
    expect(reportPrefs.level).toBe(0.99);
  });

  it("copies the parameter table or the whole report as TSV, and saves a CSV", async () => {
    open();
    await screen.findByText("ANOVA");
    fireEvent.click(screen.getByRole("button", { name: "Copy parameters" }));
    await waitFor(() => expect(useApp.getState().status).toBe("copied the fit parameters"));
    const params = vi.mocked(copyText).mock.calls[0]![0];
    expect(params.split("\n")[1]).toBe("Parameter\tValue\tStandard Error\tt-Value\tProb>|t|\tLCL (95%)\tUCL (95%)");
    expect(params).not.toContain("ANOVA");
    fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    await waitFor(() => expect(useApp.getState().status).toBe("copied the fit report"));
    expect(vi.mocked(copyText).mock.calls[1]![0]).toContain("ANOVA");
    fireEvent.click(screen.getByRole("button", { name: "Save report CSV" }));
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), "run-Linear-fit-report.csv");
  });
});
