// Statistical tests workshop — pick a test and its columns, run it, read the
// one-sentence interpretation + results table, copy/export/report it.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    pickTest(/power/);
    fireEvent.change(screen.getByLabelText("Effect size d"), { target: { value: "0.8" } });
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
});
