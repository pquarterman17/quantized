// "Open in Batch integrate" (lane RO2): the trend reopens with EVERY recorded
// source picked, its windows, baseline, alignment and trend X, plots the
// recorded channel, fails closed on a missing or changed source, and a re-run
// replaces the old trend through the layout verdict.

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { integratePeaksBatch, type IntegrateBatchPeak } from "../../../lib/api/peaks";
import type { DataStruct } from "../../../lib/types";
import { useToolReopen } from "../../../store/toolReopen";
import { openCommittedResultInTool } from "../../../store/toolReopenOpen";
import { useApp } from "../../../store/useApp";
import { analysisResultsReset } from "../peaks/batchIntegrateTestSetup";
import BatchIntegrateWindow from "../peaks/BatchIntegrateWindow";

vi.mock("../../../lib/api/peaks", () => ({ integratePeaksBatch: vi.fn() }));
vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));

const scan = (temperature: string, labels = ["I", "J"]): DataStruct => ({
  time: [0, 1, 2, 3, 4, 5], values: [[1, 9], [5, 9], [2, 9], [6, 9], [2, 9], [1, 9]],
  labels, units: labels.map(() => "cps"), metadata: { temperature },
});
const peak = (area: number): IntegrateBatchPeak => ({
  region: [0.5, 1.5], area, area_pct: 100, centroid: 1, height: 5, position: 1, fwhm: 0.5,
});

const trends = () => useApp.getState().datasets.filter((d) => d.data.metadata.source === "peak-batch-integrate");
const resultId = () => useApp.getState().analysisResults[0]!.id;

beforeEach(() => {
  vi.clearAllMocks();
  useToolReopen.setState({ sessions: {} });
  useApp.setState({
    datasets: [{ id: "d1", name: "hot", data: scan("300 K") }, { id: "d2", name: "cold", data: scan("100 K") }],
    activeId: "d1", selectedIds: ["d1", "d2"], xKey: null, yKeys: [0], seriesOrder: null, peaksOpen: false,
    ...analysisResultsReset,
  });
  vi.mocked(integratePeaksBatch).mockResolvedValue({
    regions: [[0.5, 1.5]], n_spectra: 2, n_regions: 1, aligned: false, reference: 0, baseline: "none", n_failed: 0,
    results: [
      { index: 0, label: "hot", ok: true, shift_samples: 0, shift_x: 0, total_area: 3, peaks: [peak(3)] },
      { index: 1, label: "cold", ok: true, shift_samples: 0, shift_x: 0, total_area: 7, peaks: [peak(7)] },
    ],
  });
});

/** Commit a trend with the baseline OFF through the window, then close it. */
async function commitTrend(): Promise<void> {
  const view = render(<BatchIntegrateWindow seedPeaks={[{ center: 1, fwhm: 0.5 }]} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("batch baseline"), { target: { value: "none" } });
  fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
  await screen.findByRole("region", { name: "batch integration results" });
  fireEvent.click(screen.getByRole("button", { name: "Add trend dataset" }));
  expect(trends()).toHaveLength(1);
  view.unmount();
}

describe("Batch integrate: reopen, adjust, replace", () => {
  it("reopens with every recorded source picked and the recorded windows and baseline", async () => {
    await commitTrend();
    act(() => { expect(openCommittedResultInTool(resultId())).toBe(true); });
    expect(useApp.getState().peaksOpen).toBe(true);
    // Reopened with NO peaks to seed from: the windows come from the record.
    render(<BatchIntegrateWindow seedPeaks={[]} onClose={() => {}} />);
    expect(screen.getByText("Datasets (2 picked)")).toBeInTheDocument();
    expect(screen.getByLabelText("window 1 low")).toHaveValue("0.5");
    expect(screen.getByLabelText("batch baseline")).toHaveValue("none");
    expect(screen.getByText(/Opened from the result/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Replace “Integrated I/ })).toBeChecked();
    expect(useToolReopen.getState().sessions["peak-batch-integrate"]!.sourceIds).toEqual(["d1", "d2"]);
  });

  it("plots the recorded channel, as one undoable step, when another is plotted", async () => {
    await commitTrend();
    act(() => useApp.setState({ yKeys: [1] }));
    act(() => { openCommittedResultInTool(resultId()); });
    expect(useApp.getState().yKeys).toEqual([0]);
    expect(useApp.getState().status).toContain("plotted “I”");
    expect(useApp.getState().history.map((h) => h.label)).toEqual(["add Batch integrate output", "plot the recorded Batch integrate channel"]);
  });

  it("a re-run replaces the old trend in ONE undo step; Undo restores it", async () => {
    await commitTrend();
    const [old] = trends();
    const oldResult = useApp.getState().analysisResults[0];
    act(() => { openCommittedResultInTool(resultId()); });
    render(<BatchIntegrateWindow seedPeaks={[]} onClose={() => {}} />);
    vi.mocked(integratePeaksBatch).mockResolvedValue({
      regions: [[0.5, 1.5]], n_spectra: 2, n_regions: 1, aligned: false, reference: 0, baseline: "none", n_failed: 0,
      results: [
        { index: 0, label: "hot", ok: true, shift_samples: 0, shift_x: 0, total_area: 30, peaks: [peak(30)] },
        { index: 1, label: "cold", ok: true, shift_samples: 0, shift_x: 0, total_area: 70, peaks: [peak(70)] },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    await screen.findByRole("region", { name: "batch integration results" });
    fireEvent.click(screen.getByRole("button", { name: "Add trend dataset" }));
    expect(trends()).toHaveLength(1);
    expect(trends()[0]!.id).toBe(old!.id);
    expect(trends()[0]!.data.values.map((r) => r[0])).toEqual([30, 70]);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().analysisResults[0]!.id).toBe(oldResult!.id);
    expect(useApp.getState().analysisResults[0]!.sources.map((s) => s.datasetId)).toEqual(["d1", "d2"]);
    // Adding the trend plotted IT, so reopening re-plotted the recorded channel (its own step); the replace is ONE more.
    expect(useApp.getState().history.map((h) => h.label)).toEqual([
      "add Batch integrate output", "plot the recorded Batch integrate channel", "replace Batch integrate output",
    ]);
    act(() => useApp.getState().undo());
    expect(trends()[0]!.data).toEqual(old!.data);
    expect(useApp.getState().analysisResults).toEqual([oldResult]);
  });

  it("Add as a new output keeps the old trend", async () => {
    await commitTrend();
    act(() => { openCommittedResultInTool(resultId()); });
    render(<BatchIntegrateWindow seedPeaks={[]} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "Add as a new output" }));
    fireEvent.change(screen.getByLabelText("window 1 low"), { target: { value: "0.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    await screen.findByRole("region", { name: "batch integration results" });
    fireEvent.click(screen.getByRole("button", { name: "Add trend dataset" }));
    expect(trends()).toHaveLength(2);
    expect(useApp.getState().analysisResults).toHaveLength(2);
  });

  it("Replace goes through the layout verdict: a bound column that would vanish disables it, by name", async () => {
    await commitTrend();
    const out = trends()[0]!;
    // Another result plots the trend's first column; the new windows rename every column.
    useApp.setState((s) => ({
      analysisResults: [...s.analysisResults, {
        ...s.analysisResults[0]!, id: "reader", name: "Reader", producer: { id: "other", label: "Other", version: 1 },
        sources: [], outputs: [], parameters: {}, tableRefs: [], plotBindings: [{ datasetId: out.id, channels: [0] }],
      }],
    }));
    act(() => { openCommittedResultInTool(resultId()); });
    render(<BatchIntegrateWindow seedPeaks={[]} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("window 1 low"), { target: { value: "0.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Integrate" }));
    await screen.findByRole("region", { name: "batch integration results" });
    expect(await screen.findByText(/Replace would remove column/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Replace “/ })).toBeDisabled();
    // The commit adds a new trend instead of replacing (the old one is untouched).
    fireEvent.click(screen.getByRole("button", { name: "Add trend dataset" }));
    expect(trends()).toHaveLength(2);
    expect(trends().find((d) => d.id === out.id)!.data).toEqual(out.data);
  });

  it("a missing source opens WITHOUT the settings, with a notice, and cannot replace", async () => {
    await commitTrend();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.filter((d) => d.id !== "d2") })));
    act(() => { openCommittedResultInTool(resultId()); });
    const session = useToolReopen.getState().sessions["peak-batch-integrate"]!;
    expect(session).toMatchObject({ seed: null, sourceId: null, mode: "new" });
    expect(session.notice).toMatch(/1 of the 2 recorded source worksheets/);
    render(<BatchIntegrateWindow seedPeaks={[]} onClose={() => {}} />);
    expect(screen.queryByLabelText("window 1 low")).toBeNull(); // no recorded windows applied
  });

  it("a changed further source says which one, and keeps the settings", async () => {
    await commitTrend();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "d2" ? { ...d, data: { ...scan("100 K"), time: [0, 1, 2, 3, 4, 9] } } : d)) })));
    act(() => { openCommittedResultInTool(resultId()); });
    const session = useToolReopen.getState().sessions["peak-batch-integrate"]!;
    expect(session.seed).not.toBeNull();
    expect(session.notice).toContain("“cold” changed after this result was computed");
  });
});
