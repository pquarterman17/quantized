// OG20 through the real Distribution panel and the real result panel: a result saved while rows 21-44 are the
// analysis input is SAVED with exactly the numbers the tool showed for that range, and the saved result's panel
// says which rows they came from. The fixture is statsRowRange's: 48 rows, v = 2 * row + 5, rows 25, 30 and 40
// (0-based) excluded, rows 21-44 (1-based) set, so 21 rows are analysed.
//
// The reference values are numpy on exactly those 21 source rows (computed offline, ddof=1 for the std):
//   N 21, mean 67.95238095238095, median 69, std 14.3752432691631, min 45, max 91, q1 57, q3 79.
// The descriptive-statistics call is stubbed to answer ONLY for those exact rows, so a saved table that reads
// them proves the window the tool read is the window the save records.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));
vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsHistogram: vi.fn(), statsShapiro: vi.fn(), statsFitDistributions: vi.fn(), reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn() }));
vi.mock("../../../lib/api/statsCi", () => ({ statsConfidenceIntervals: vi.fn(() => new Promise(() => undefined)) }));

import { statsFitDistributions, statsHistogram, statsShapiro } from "../../../lib/api";
import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import { ROW_RANGE_PARAM } from "../../../lib/inputRowRange";
import type { DataStruct, Dataset } from "../../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { openWorksheetRowRange } from "../../../store/worksheetAnalysisHandoff";
import AnalysisResultPanel from "../analysisresults/AnalysisResultPanel";
import DistributionPanel from "./DistributionPanel";

const ROWS = 48;
const EXCLUDED = [25, 30, 40];
const USED = Array.from({ length: 24 }, (_v, i) => 20 + i).filter((row) => !EXCLUDED.includes(row));
const v = (row: number) => 2 * row + 5;
const NUMPY = { N: 21, mean: 67.95238095238095, median: 69, std: 14.3752432691631, min: 45, max: 91, q1: 57, q3: 79 };

const DATA: DataStruct = {
  time: Array.from({ length: ROWS }, (_v, i) => i),
  values: Array.from({ length: ROWS }, (_v, i) => [v(i)]),
  labels: ["v"], units: [""], metadata: { x_column_name: "t" },
};
const SHEET: Dataset = { id: "d1", name: "run.csv", data: DATA, excludedRows: EXCLUDED };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsHistogram).mockResolvedValue({ counts: [21], centers: [68], edges: [45, 91], n_bins: 1, n: 21 } as never);
  vi.mocked(statsShapiro).mockResolvedValue({ W: 0.95, p: 0.5, N: 21 } as never);
  vi.mocked(statsFitDistributions).mockResolvedValue({ fits: [], best: null, skipped: [] } as never);
  vi.mocked(statsDescriptive).mockImplementation((async (values: number[]) => {
    const same = values.length === USED.length && values.every((x, i) => x === v(USED[i]!));
    if (!same) throw new Error(`descriptive stats asked for rows other than rows 21-44: ${values.length} values`);
    return NUMPY;
  }) as never);
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({
    datasets: [SHEET], activeId: "d1", status: "", selection: null, reports: [], distributionOpen: true,
    analysisResults: [], history: [], future: [], openAnalysisResultId: null,
  });
});

describe("saving Distribution under rows 21-44", () => {
  it("saves the numbers the tool showed for those rows, records the window, and the result panel says so", async () => {
    openWorksheetRowRange("d1", Array.from({ length: 24 }, (_v, i) => 20 + i));
    render(<DistributionPanel />);
    await screen.findByLabelText("histogram");
    const save = await screen.findByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    const [saved] = useApp.getState().analysisResults;
    expect(saved).toBeDefined();
    expect(saved!.parameters?.[ROW_RANGE_PARAM]).toEqual({ from: 20, to: 43, rows: 48 });
    // The saved Summary table is numpy on exactly rows 21-44 (minus the three excluded ones).
    const summary = Object.fromEntries(saved!.tables!.find((t) => t.title === "Summary")!.rows.map((r) => [String(r[0]), r[1]]));
    for (const key of ["N", "mean", "median", "std", "min", "q1", "q3", "max"] as const) {
      expect(summary[key], key).toBeCloseTo(NUMPY[key], 9);
    }

    // The saved result's own panel names the rows, as history.
    useApp.setState({ openAnalysisResultId: saved!.id });
    render(<AnalysisResultPanel />);
    expect(await screen.findByText("rows 21-44 of 48 (when saved)")).toBeInTheDocument();
  });

  it("after a ranged save the panel reads Saved and enables its actions; clearing the range reads Not saved (the live key carries the window)", async () => {
    openWorksheetRowRange("d1", Array.from({ length: 24 }, (_v, i) => 20 + i));
    render(<DistributionPanel />);
    const save = await screen.findByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.getAllByText("Not saved").length).toBeGreaterThan(0);
    fireEvent.click(save);
    await waitFor(() => expect(screen.getAllByText("Saved").length).toBeGreaterThan(0));
    expect(screen.queryByText("Not saved")).toBeNull();
    expect(screen.getByRole("button", { name: "Open saved result" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save result" })).toBeDisabled(); // already saved, not a duplicate
    // The same question over EVERY row is another computation: not saved, and Save is offered again.
    vi.mocked(statsDescriptive).mockResolvedValue(NUMPY as never);
    act(() => useAnalysisSelection.getState().updateItem("d1", { rowRange: null }));
    await waitFor(() => expect(screen.getAllByText("Not saved").length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save result" })).toBeEnabled());
  });

  it("the saved result survives a .dwk save and reopen and still shows its range", async () => {
    openWorksheetRowRange("d1", Array.from({ length: 24 }, (_v, i) => 20 + i));
    render(<DistributionPanel />);
    const save = await screen.findByRole("button", { name: "Save result" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    const text = serializeWorkspace({ datasets: useApp.getState().datasets, analysisResults: useApp.getState().analysisResults });
    expect((JSON.parse(text) as { version: number }).version).toBe(9);

    useApp.setState({ datasets: [], analysisResults: [], activeId: null });
    useApp.getState().loadWorkspace(parseWorkspace(text));
    const reopened = useApp.getState().analysisResults[0]!;
    expect(reopened.parameters?.[ROW_RANGE_PARAM]).toEqual({ from: 20, to: 43, rows: 48 });
    useApp.setState({ openAnalysisResultId: reopened.id });
    render(<AnalysisResultPanel />);
    expect(await screen.findByText("rows 21-44 of 48 (when saved)")).toBeInTheDocument();
  });
});
