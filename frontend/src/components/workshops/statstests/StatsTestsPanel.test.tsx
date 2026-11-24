// Statistical tests workshop — pick a test and its columns, run it, read the
// one-sentence interpretation + results table, copy/export/report it.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAnalysisCommands } from "../../../commands/analysisCommands";
import { resetBookTransportForTests } from "../../../lib/bookData";
import { DEFAULT_PARAMS, DEFAULT_SELECTION } from "../../../lib/statsTests";
import type { Dataset } from "../../../lib/types";
import { useStatsTestsStore } from "../../../store/statsTests";
import { useApp } from "../../../store/useApp";
import StatsTestsPanel from "./StatsTestsPanel";

const { runMock, saveBlobMock, emitMock, fetchBookDataMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
  saveBlobMock: vi.fn(),
  emitMock: vi.fn(),
  fetchBookDataMock: vi.fn(),
}));

vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: runMock,
}));
vi.mock("../../../lib/download", () => ({ saveBlob: saveBlobMock }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  reportEmit: emitMock,
  fetchBookData: fetchBookDataMock,
}));

const ds: Dataset = {
  id: "d1",
  name: "films",
  data: {
    time: [1, 2, 3, 4, 5],
    values: [
      [10, 20, 5],
      [11, 21, 6],
      [12, 22, 4],
      [13, 23, 7],
      [14, 24, 5],
    ],
    labels: ["Hc", "Ms", "Mr"],
    units: ["", "", ""],
    metadata: { x_column_name: "T" },
  },
};

const KS2 = { D: 1, p: 0.008, n1: 5, n2: 5, alternative: "two-sided", method: "Kolmogorov-Smirnov (two-sample)" };

function pickTest(label: RegExp): void {
  const select = screen.getByLabelText("Test") as HTMLSelectElement;
  const option = Array.from(select.options).find((o) => label.test(o.text));
  if (!option) throw new Error(`no test option matching ${label}`);
  fireEvent.change(select, { target: { value: option.value } });
}

beforeEach(() => {
  resetBookTransportForTests();
  vi.clearAllMocks();
  fetchBookDataMock.mockReset().mockReturnValue(new Promise(() => {}));
  useApp.setState({
    datasets: [ds], activeId: "d1", status: "", reports: [], openReportId: null,
    analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
  useStatsTestsStore.setState({ open: true, request: null });
});

describe("StatsTestsPanel", () => {
  it("opens from the Analyze ▸ Statistics command", () => {
    useStatsTestsStore.setState({ open: false });
    const cmd = buildAnalysisCommands(useApp.getState).find((c) => c.id === "stats-tests");
    expect(cmd?.section).toBe("Statistics");
    cmd?.run();
    expect(useStatsTestsStore.getState().open).toBe(true);
  });

  it("consumes an exact saved question when reopened from a result", async () => {
    useStatsTestsStore.getState().openWith({
      testId: "ks-two-sample",
      selection: { ...DEFAULT_SELECTION, x: 1, y: 2 },
      params: { ...DEFAULT_PARAMS, alpha: 0.01 },
    });
    render(<StatsTestsPanel />);
    await waitFor(() => expect((screen.getByLabelText("Test") as HTMLSelectElement).value).toBe("ks-two-sample"));
    expect((screen.getByLabelText("First column") as HTMLSelectElement).value).toBe("1");
    expect((screen.getByLabelText("Second column") as HTMLSelectElement).value).toBe("2");
    expect(useStatsTestsStore.getState().request).toBeNull();
  });

  it("runs a two-sample KS test on the picked columns and interprets it in one sentence", async () => {
    runMock.mockResolvedValue({ id: "ks-two-sample", data: KS2 });
    render(<StatsTestsPanel />);
    pickTest(/Two-sample Kolmogorov/);
    fireEvent.change(screen.getByLabelText("Second column"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));

    expect(
      await screen.findByText("p = 0.008: the distributions of Hc and Ms differ at the 5% level."),
    ).toBeInTheDocument();
    expect(runMock).toHaveBeenCalledWith({
      id: "ks-two-sample",
      body: { x: [10, 11, 12, 13, 14], y: [20, 21, 22, 23, 24], alternative: "two-sided" },
    });
    expect(screen.getByRole("cell", { name: "D" })).toBeInTheDocument();
    expect(useApp.getState().analysisResults).toEqual([expect.objectContaining({
      producer: { id: "statistical-test", label: "Statistical Test", version: 1 },
      sources: [{ datasetId: "d1", role: "input" }],
      parameters: expect.objectContaining({ testId: "ks-two-sample" }),
      tables: [{ columns: ["statistic", "value"], rows: expect.arrayContaining([["D", 1], ["p", 0.008]]) }],
    })]);
    useApp.getState().undo();
    expect(useApp.getState().analysisResults).toEqual([]);
  });

  it("shows the run as a result book whose table actions use THIS run's saved result, and say when it is gone", async () => {
    runMock.mockResolvedValue({ id: "ks-two-sample", data: KS2 });
    render(<StatsTestsPanel />);
    pickTest(/Two-sample Kolmogorov/);
    fireEvent.change(screen.getByLabelText("Second column"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await screen.findByText(/p = 0\.008/);
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Kolmogorov");
    const titles = screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent?.replace(/^[▾▸]\s*/, ""));
    expect(titles).toEqual(["Result", "Table 1"]); // the KS table is untitled
    expect(screen.getByRole("button", { name: "Send to report: Table 1" })).toBeEnabled();
    // The saved book's Freeze rule applies here too (a mixed text/number column).
    expect(screen.getByRole("button", { name: "Open as worksheet: Table 1" })).toHaveAttribute("title", expect.stringMatching(/^Can't open as a worksheet/));
    expect(screen.getByRole("button", { name: "Open saved result" })).toBeEnabled();
    act(() => { useApp.getState().undo(); });
    const send = await screen.findByRole("button", { name: "Send to report: Table 1" });
    await waitFor(() => expect(send).toBeDisabled());
    expect(send).toHaveAttribute("title", expect.stringMatching(/deleted or undone/));
    expect(screen.getByRole("button", { name: "Open saved result" })).toBeDisabled();
  });

  it("runs ROC on an outcome and a score and saves the result", async () => {
    runMock.mockResolvedValue({
      id: "roc",
      data: {
        roc: { fpr: [0, 1], tpr: [0, 1], thresholds: [null, 4], auc: 0.9, N: 5, nPositive: 2, nNegative: 3 },
        youden: { optimalThreshold: 4, youdenJ: 0.8, fpr: 0.1, tpr: 0.9 },
      },
    });
    useApp.setState({ datasets: [{ ...ds, data: { ...ds.data, values: [[0, 1, 5], [0, 2, 6], [1, 3, 4], [1, 4, 7], [0, 5, 5]] } }] });
    render(<StatsTestsPanel />);
    pickTest(/ROC/);
    fireEvent.change(screen.getByLabelText("Outcome (0/1)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Score"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/^AUC = 0\.9: Ms separates Hc = 1/)).toBeInTheDocument();
    expect(runMock).toHaveBeenCalledWith({ id: "roc", body: { y_true: [0, 0, 1, 1, 0], y_score: [1, 2, 3, 4, 5] } });
    expect(useApp.getState().analysisResults).toEqual([expect.objectContaining({
      parameters: expect.objectContaining({ testId: "roc" }),
    })]);
  });

  it("refuses ROC for a column that is not coded 0/1 without calling the backend", async () => {
    render(<StatsTestsPanel />);
    pickTest(/ROC/);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/must be coded 0\/1/)).toBeInTheDocument();
    expect(runMock).not.toHaveBeenCalled();
    expect(useApp.getState().analysisResults).toEqual([]);
  });

  it("adjusts a p-value column with the chosen method", async () => {
    runMock.mockResolvedValue({ id: "adjust-p", data: { adjusted: [0.5, 0.5], method: "bonferroni", m: 2, p_values: [0.25, 0.25] } });
    useApp.setState({ datasets: [{ ...ds, data: { ...ds.data, time: [1, 2], values: [[0.25, 0, 0], [0.25, 0, 0]] } }] });
    render(<StatsTestsPanel />);
    pickTest(/P-value adjustment/);
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "bonferroni" } });
    fireEvent.change(screen.getByLabelText("P-values"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/^Bonferroni adjustment of 2 p-values/)).toBeInTheDocument();
    expect(runMock).toHaveBeenCalledWith({ id: "adjust-p", body: { p_values: [0.25, 0.25], method: "bonferroni" } });
  });

  it("copies the results as TSV and exports them as CSV", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    runMock.mockResolvedValue({ id: "ks-two-sample", data: KS2 });
    render(<StatsTestsPanel />);
    pickTest(/Two-sample Kolmogorov/);
    fireEvent.change(screen.getByLabelText("Second column"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    await screen.findByRole("button", { name: "Copy table" });

    fireEvent.click(screen.getByRole("button", { name: "Copy table" }));
    await waitFor(() => expect(useApp.getState().status).toMatch(/copied/));
    expect(writeText.mock.calls[0][0]).toMatch(/^p = 0\.008: .*\n\nstatistic\tvalue\nD\t1\n/);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(saveBlobMock).toHaveBeenCalledWith(expect.any(Blob), "ks-two-sample_films.csv");
  });

  it("lands the result as a report", async () => {
    runMock.mockResolvedValue({ id: "ks-two-sample", data: KS2 });
    emitMock.mockResolvedValue({ report: { title: "t", sections: [] } });
    render(<StatsTestsPanel />);
    pickTest(/Two-sample Kolmogorov/);
    fireEvent.change(screen.getByLabelText("Second column"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    fireEvent.click(await screen.findByRole("button", { name: "→ Report" }));

    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(emitMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "stats_table", caption: expect.stringMatching(/^p = 0\.008/) }),
    );
  });

  it("says what is missing instead of calling the backend", async () => {
    render(<StatsTestsPanel />);
    pickTest(/Partial correlation/);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));

    expect(await screen.findByText("Pick at least 3 columns.")).toBeInTheDocument();
    expect(runMock).not.toHaveBeenCalled();
  });

  it("plans a sample size with no dataset open", async () => {
    useApp.setState({ datasets: [], activeId: null });
    runMock.mockResolvedValue({
      id: "power",
      data: { n: 26, achieved_power: 0.807, target_power: 0.8, effect_size: 0.8, kind: "two-sample", alpha: 0.05, tails: 2 },
    });
    render(<StatsTestsPanel />);
    pickTest(/t-test power/);
    fireEvent.change(screen.getByLabelText("Effect size d"), { target: { value: "0.8" } });
    fireEvent.blur(screen.getByLabelText("Effect size d")); // commits on blur (one write per edit)
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));

    expect(await screen.findByText(/needs n = 26 per group for 80% power/)).toBeInTheDocument();
    expect(runMock).toHaveBeenCalledWith({
      id: "power",
      body: { effect_size: 0.8, power: 0.8, kind: "two-sample", alpha: 0.05, tails: 2 },
    });
    expect(useApp.getState().analysisResults[0]).toMatchObject({
      producer: { id: "statistical-test" }, sources: [], outputs: [],
    });
  });

  it("shows a backend rejection inline", async () => {
    runMock.mockRejectedValue(new Error("anderson: need at least 8 observations"));
    render(<StatsTestsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));
    expect(await screen.findByText(/need at least 8 observations/)).toBeInTheDocument();
  });

  it("loads the full Origin book before running", async () => {
    fetchBookDataMock.mockResolvedValueOnce(ds.data);
    runMock.mockResolvedValue({
      id: "anderson",
      data: { A2: 0.2, critical_values: [0.5, 0.6, 0.7, 0.8, 0.9], significance_levels_pct: [15, 10, 5, 2.5, 1], reject_at_5pct: false, N: 5, method: "AD" },
    });
    useApp.setState({
      datasets: [{ ...ds, data: { ...ds.data, time: [1, 2], values: ds.data.values.slice(0, 2) }, pending: { kind: "upload", bookId: "b1", rows: 5, cols: 3, previewSampled: true } }],
    });
    render(<StatsTestsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Run test" }));

    expect(await screen.findByText(/no evidence Hc departs from normal/)).toBeInTheDocument();
    expect(runMock).toHaveBeenCalledWith({ id: "anderson", body: { x: [10, 11, 12, 13, 14] } });
  });

  describe("survival", () => {
    const surv: Dataset = {
      id: "s1", name: "trial",
      data: {
        time: [1, 2, 3, 4, 5, 6],
        values: [[5, 1, 0], [6, 0, 0], [7, 1, 0], [8, 1, 1], [9, 0, 1], [10, 1, 1]],
        labels: ["weeks", "relapse", "arm"], units: ["", "", ""], metadata: {},
      },
    };
    const curve = { times: [0, 5], survival: [1, 0.8], ciLow: [1, 0.5], ciHigh: [1, 0.9], atRisk: [6, 6], events: [0, 1], medianSurvival: null, medianCiLow: null, medianCiHigh: null, N: 6 };

    it("runs Kaplan-Meier on the analysis rows (excluded rows left out) and saves a result", async () => {
      useApp.setState({ datasets: [{ ...surv, excludedRows: [0] }], activeId: "s1" });
      runMock.mockResolvedValue({ id: "kaplan-meier", data: { groups: [{ label: "", curve }] } });
      render(<StatsTestsPanel />);
      pickTest(/Kaplan-Meier/);
      fireEvent.change(screen.getByLabelText("Time"), { target: { value: "0" } });
      fireEvent.change(screen.getByLabelText("Event (0/1)"), { target: { value: "1" } });
      fireEvent.click(screen.getByRole("button", { name: "Run test" }));
      expect(await screen.findByText(/median survival in weeks units is not reached/)).toBeInTheDocument();
      expect(runMock).toHaveBeenCalledWith({
        id: "kaplan-meier",
        body: { groups: [{ label: "", time: [6, 7, 8, 9, 10], event: [0, 1, 1, 0, 1] }] },
      });
      expect(useApp.getState().analysisResults[0]).toMatchObject({ parameters: { testId: "kaplan-meier" } });
    });

    it("refuses an event column that is not 0/1 with the reason, without calling the backend", async () => {
      useApp.setState({ datasets: [surv], activeId: "s1" });
      render(<StatsTestsPanel />);
      pickTest(/Log-rank/);
      fireEvent.change(screen.getByLabelText("Time"), { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Event (0/1)"), { target: { value: "0" } });
      fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "2" } });
      fireEvent.click(screen.getByRole("button", { name: "Run test" }));
      expect(await screen.findByText(/weeks must be coded 0\/1/)).toBeInTheDocument();
      expect(runMock).not.toHaveBeenCalled();
    });
  });
});
