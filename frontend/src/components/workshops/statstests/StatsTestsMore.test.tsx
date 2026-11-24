// Statistical tests workshop — GAP_AUDIT_9 G6 panel behaviour: the equivalence
// margin is required (fail closed), summary-count proportion tests run without
// columns and are saved as results, and the group tests offer their method.

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

const ds: Dataset = {
  id: "d1", name: "films",
  data: {
    time: [1, 2, 3, 4], values: [[10, 20], [11, 21], [12, 22], [13, 23]],
    labels: ["old", "new"], units: ["", ""], metadata: {},
  },
};

function pickTest(label: RegExp): void {
  const select = screen.getByLabelText("Test") as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => label.test(o.text));
  if (!option) throw new Error(`no test option matching ${label}`);
  fireEvent.change(select, { target: { value: option.value } });
}

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  useApp.setState({
    datasets: [ds], activeId: "d1", status: "", reports: [], openReportId: null,
    analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
  useStatsTestsStore.setState({ open: true, request: null });
});

describe("G6 tests in the Statistical tests panel", () => {
  it("refuses an equivalence test until a margin is set, then sends it", async () => {
    runMock.mockResolvedValue({
      id: "tost-two",
      data: {
        diff: -10, se: 1, df: 6, low: -15, high: 15, alpha: 0.05, t_lower: 5, p_lower: 0.001, t_upper: -25, p_upper: 1e-7, p: 0.001,
        ci_low: -12, ci_high: -8, ci_level: 0.9, equivalent: true, effect_size: -6, method: "TOST Welch t", design: "welch",
      },
    });
    render(<StatsTestsPanel />);
    pickTest(/Equivalence, two samples/);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/Set an equivalence margin/)).toBeInTheDocument();
    expect(runMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Equivalence margin (±)"), { target: { value: "15" } });
    fireEvent.blur(screen.getByLabelText("Equivalence margin (±)"));
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/equivalent at the 5% level/)).toBeInTheDocument();
    expect(runMock).toHaveBeenCalledWith({
      id: "tost-two", body: { x: [10, 11, 12, 13], y: [20, 21, 22, 23], design: "welch", margin: 15, alpha: 0.05 },
    });
    expect(useApp.getState().analysisResults).toHaveLength(1);
  });

  it("runs a proportion test from typed counts, with no columns", async () => {
    runMock.mockResolvedValue({
      id: "binomial-test",
      data: {
        x: 7, n: 20, phat: 0.35, p0: 0.5, alternative: "two-sided", alpha: 0.05, effect_size: -0.3, p: 0.263, statistic: null,
        ci_low: 0.15, ci_high: 0.59, ci_method: "Clopper-Pearson", method: "Exact binomial test", significant: false,
      },
    });
    render(<StatsTestsPanel />);
    pickTest(/One proportion/);
    expect(screen.queryByLabelText("Effect size d")).not.toBeInTheDocument(); // the power fields stay power-only
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/Enter the successes and trials/)).toBeInTheDocument();
    for (const [label, v] of [["Successes", "7"], ["Trials", "20"]]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
      fireEvent.blur(screen.getByLabelText(label));
    }
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/no evidence the success rate differs from 0.5/)).toBeInTheDocument();
    expect(runMock).toHaveBeenCalledWith({
      id: "binomial-test",
      body: { successes: 7, trials: 20, p0: 0.5, method: "exact", alternative: "two-sided", alpha: 0.05 },
    });
  });

  it("offers the post hoc method and the variance-test method", () => {
    render(<StatsTestsPanel />);
    pickTest(/Post hoc/);
    const method = screen.getByLabelText("Comparison method") as HTMLSelectElement;
    expect(Array.from(method.options).map((o) => o.value)).toEqual(["games-howell", "tukey", "scheffe", "lsd", "dunn-sidak"]);
    pickTest(/Equal-variance/);
    expect(Array.from((screen.getByLabelText("Variance test") as HTMLSelectElement).options).map((o) => o.value))
      .toEqual(["bartlett", "levene", "brown-forsythe", "f-test"]);
  });
});
