// Statistical tests workshop — GAP_AUDIT_9 G26 panel behaviour: pick responses
// and factors, run, read the sentence, see the bar chart and p-value plot, sort
// the table, and have the run saved as a result.

import { fireEvent, render, screen, within } from "@testing-library/react";
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
  id: "d1", name: "runs",
  data: {
    time: [1, 2, 3, 4], values: [[1, 10, 0], [2, 20, 1], [3, 30, 0], [5, 40, 1]],
    labels: ["resistance", "temp", "recipe"], units: ["", "", ""], metadata: {}, cat_levels: { 2: ["A", "B"] },
  },
};

const row = (over: object) => ({
  y: "resistance", x: "temp", x_kind: "continuous", test: "linear regression", n: 4, n_levels: null, effect_label: "r", effect_size: 0.9,
  estimate_label: "slope", estimate: 0.1, ci_low: 0, ci_high: 0.2, statistic: 5, df: 2, p: 0.03, p_adjusted: 0.06, logworth: 1.5,
  adj_logworth: 1.2, significant: false, reason: null, ...over,
});
const result = {
  id: "response-screening",
  data: {
    method: "bh", alpha: 0.05, n_pairs: 2, n_tested: 2, n_degenerate: 0, n_significant: 1,
    results: [row({}), row({ x: "recipe", x_kind: "nominal", test: "two-sample t (pooled)", p: 0.001, p_adjusted: 0.002, logworth: 3, adj_logworth: 2.7, significant: true })],
  },
};

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  useApp.setState({ datasets: [ds], activeId: "d1", status: "", reports: [], openReportId: null, analysisResults: [], openAnalysisResultId: null, history: [], future: [] });
  useStatsTestsStore.setState({ open: true, request: null });
});

function pickScreening(): void {
  const select = screen.getByLabelText("Test") as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => /Response screening/.test(o.text));
  fireEvent.change(select, { target: { value: option!.value } });
}

describe("Response screening in the Statistical tests panel", () => {
  it("runs, charts adjusted LogWorth and the p-value plot, sorts the table and saves the run", async () => {
    runMock.mockResolvedValue(result);
    render(<StatsTestsPanel />);
    pickScreening();
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/Pick at least one factor/)).toBeInTheDocument();
    expect(runMock).not.toHaveBeenCalled();

    // the default picks put temp among the responses; move it to the factors
    fireEvent.click(within(screen.getByRole("group", { name: "Responses (Y)" })).getByLabelText("temp"));
    fireEvent.click(within(screen.getByRole("group", { name: "Factors (X)" })).getByLabelText("temp"));
    fireEvent.click(within(screen.getByRole("group", { name: "Factors (X)" })).getByLabelText("recipe"));
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/1 of 2 tested Y × X pairs are significant after Benjamini-Hochberg/)).toBeInTheDocument();
    expect((runMock.mock.calls[0][0] as { body: { x: { kind: string }[] } }).body.x.map((x) => x.kind)).toEqual(["continuous", "nominal"]);
    expect(screen.getByRole("img", { name: "Adjusted LogWorth bar chart" })).toBeInTheDocument();
    expect(document.querySelectorAll("g[data-bar]")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "p-value plot" })).toBeInTheDocument();
    expect(document.querySelectorAll("circle[data-point]")).toHaveLength(2);

    const header = screen.getByRole("button", { name: "n" });
    fireEvent.click(header);
    expect(header.closest("th")).toHaveAttribute("aria-sort", "ascending");
    expect(useApp.getState().analysisResults).toHaveLength(1);
  });
});
