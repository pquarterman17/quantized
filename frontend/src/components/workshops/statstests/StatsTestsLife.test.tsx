// Statistical tests workshop — GAP_AUDIT_9 G8 panel behaviour: censored life data
// is sent with the 1 = censored convention, the probability plot and Kaplan-Meier
// curve are drawn, a bad censor column is refused before any request, and the
// run is saved as a result.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetBookTransportForTests } from "../../../lib/bookData";
import type { Dataset } from "../../../lib/types";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useApp } from "../../../store/useApp";
import StatsTestsPanel from "./StatsTestsPanel";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));

const ds = (censor: number[]): Dataset => ({
  id: "d1", name: "breakdown",
  data: {
    time: [1, 2, 3, 4, 5, 6], values: [[54, censor[0]], [187, censor[1]], [216, censor[2]], [240, censor[3]], [500, censor[4]], [500, censor[5]]],
    labels: ["hours", "censored"], units: ["", ""], metadata: {},
  },
});

function pickTest(label: RegExp): void {
  const select = screen.getByLabelText("Test") as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => label.test(o.text));
  if (!option) throw new Error(`no test option matching ${label}`);
  fireEvent.change(select, { target: { value: option.value } });
}

function start(censor: number[]): void {
  resetBookTransportForTests();
  vi.clearAllMocks();
  useApp.setState({
    datasets: [ds(censor)], activeId: "d1", status: "", reports: [], openReportId: null,
    analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
  useStatsTestsStore.setState({ open: true, request: null });
}

const result = {
  id: "life-distribution",
  data: {
    distribution: "weibull", n: 6, n_failed: 4, n_censored: 2, alpha: 0.05, ci_method: "Wald",
    parameters: [{ name: "eta (scale, 63.2% life)", estimate: 380, se: 60, ci_low: 280, ci_high: 520 }, { name: "beta (shape)", estimate: 1.9, se: 0.8, ci_low: 0.8, ci_high: 4.3 }],
    loglik: -30, n_params: 2, aicc: 71, bic: 70, comparison: [],
    quantiles: [{ p: 0.1, time: 120, ci_low: 40, ci_high: 360 }], probabilities: [],
    kaplan_meier: { times: [54, 187, 216, 240], survival: [0.83, 0.67, 0.5, 0.33], std_error: [0.15, 0.19, 0.2, 0.2], ci_low: [0.27, 0.19, 0.11, 0.04], ci_high: [0.97, 0.9, 0.8, 0.7], at_risk: [6, 5, 4, 3], events: [1, 1, 1, 1], median: 216, n: 6, ci_method: "x" },
    plot: {
      dist: "weibull", std: "sev", x_log: true, method: "median-rank",
      points: [{ t: 54, p: 0.1, z: -2.25 }, { t: 187, p: 0.3, z: -1.03 }, { t: 216, p: 0.5, z: -0.37 }, { t: 240, p: 0.7, z: 0.19 }],
      line: [{ t: 36, z: -3, z_low: -4, z_high: -2 }, { t: 360, z: 0.5, z_low: -0.3, z_high: 1.3 }],
      ticks: [{ p: 0.1, z: -2.25 }, { p: 0.5, z: -0.37 }, { p: 0.9, z: 0.83 }],
    },
  },
};

beforeEach(() => start([0, 0, 0, 0, 1, 1]));

describe("Life tests in the Statistical tests panel", () => {
  it("sends censored data, draws the probability plot and Kaplan-Meier curve, and saves the run", async () => {
    runMock.mockResolvedValue(result);
    render(<StatsTestsPanel />);
    pickTest(/Life distribution/);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/Weibull fit to 6 units \(4 failed, 2 censored\)/)).toBeInTheDocument();
    expect(runMock).toHaveBeenCalledWith({
      id: "life-distribution",
      body: {
        time: [54, 187, 216, 240, 500, 500], censor: [0, 0, 0, 0, 1, 1], distribution: "weibull", compare: false, alpha: 0.05,
        quantile_probs: [0.01, 0.1, 0.5], eval_times: [], plotting: "median-rank",
      },
    });
    expect(screen.getByRole("img", { name: "Weibull probability plot" })).toBeInTheDocument();
    expect(document.querySelectorAll("circle[data-point]")).toHaveLength(4);
    expect(screen.getByRole("img", { name: "Kaplan-Meier survival curve" })).toBeInTheDocument();
    expect(useApp.getState().analysisResults).toHaveLength(1);
  });

  it("refuses a censor column with other values before sending anything", async () => {
    start([0, 0, 2, 0, 1, 1]);
    render(<StatsTestsPanel />);
    pickTest(/Life distribution/);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/only 0 \(failed\) and 1 \(censored\)/)).toBeInTheDocument();
    expect(runMock).not.toHaveBeenCalled();
  });

  it("interval-censored test: sends lower / upper, refuses lower > upper, draws the Turnbull curve", async () => {
    const ivResult = {
      id: "life-interval",
      data: {
        ...result.data, n_exact: 0, n_interval: 4, n_left: 1, n_right: 1, ci_method: "Wald",
        turnbull: { lower: [3, 20], upper: [15, 40], mass: [0.6, 0.4], cdf: [0.6, 1], survival: [0.4, 0], n: 6, converged: true, method: "m" },
        plot: { ...result.data.plot, method: "turnbull" },
      },
    };
    runMock.mockResolvedValue(ivResult);
    // Rows: lower / upper pairs in the two columns (blank upper = right-censored).
    useApp.setState({
      datasets: [{ id: "d1", name: "insp", data: { time: [1, 2, 3, 4, 5, 6], values: [[0, 15], [10, 25], [20, 40], [30, 45], [50, NaN], [60, 90]], labels: ["lo", "up"], units: ["", ""], metadata: {} } }],
    });
    render(<StatsTestsPanel />);
    pickTest(/interval-censored/);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/Weibull fit to 6 units \(0 exact, 4 interval-, 1 left-, 1 right-censored\)/)).toBeInTheDocument();
    expect(runMock).toHaveBeenCalledWith({
      id: "life-interval",
      body: {
        lower: [0, 10, 20, 30, 50, 60], upper: [15, 25, 40, 45, null, 90], distribution: "weibull", compare: false, alpha: 0.05,
        quantile_probs: [0.01, 0.1, 0.5], eval_times: [],
      },
    });
    expect(screen.getByRole("img", { name: "Turnbull survival curve" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Kaplan-Meier survival curve" })).toBeNull();
    runMock.mockClear();
    useApp.setState({
      datasets: [{ id: "d1", name: "insp", data: { time: [1, 2], values: [[10, 5], [20, 30]], labels: ["lo", "up"], units: ["", ""], metadata: {} } }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/Row 1: lo \(10\) is greater than up \(5\)/)).toBeInTheDocument();
    expect(runMock).not.toHaveBeenCalled();
  });
});
