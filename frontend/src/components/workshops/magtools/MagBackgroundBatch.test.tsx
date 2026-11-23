// Background estimate-only batch (lane BY4): per-worksheet fit numbers, nothing
// subtracted or written, routine from each worksheet's own axis, fail closed.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { subtractHysteresisBackground, subtractMagBackground } from "../../../lib/api/magnetometry";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import MagToolsPanel from "./MagToolsPanel";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api/magnetometry", () => ({
  subtractMagBackground: vi.fn(),
  subtractHysteresisBackground: vi.fn(),
  normalizeMagMoment: vi.fn(),
  demagCorrectField: vi.fn(),
}));

const mk = (xName: string, xUnit: string, time: number[], labels = ["Moment"]): DataStruct => ({
  time, values: time.map((_, i) => labels.map(() => i + 1)), labels, units: labels.map(() => "emu"),
  metadata: { x_column_name: xName, x_column_unit: xUnit },
});
const MT = mk("Temperature", "K", [10, 20, 30, 40]);
const MH = mk("Magnetic Field", "Oe", [-10000, -5000, 5000, 10000]);
const UNKNOWN = mk("Time", "s", [1, 2, 3, 4]);
const NOCHAN = mk("Temperature", "K", [10, 20, 30, 40], ["Other"]);
const sheet = (id: string, data: DataStruct): Dataset => ({ id, name: `${id}.dat`, data });

function setup(datasets: Dataset[]) {
  useApp.setState({
    datasets, activeId: "a", selectedIds: datasets.map((d) => d.id), xKey: null, yKeys: null, seriesOrder: null,
    errKeys: {}, selection: null, analysisResults: [], history: [], future: [], status: "",
    resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
  });
}
const openBatch = () => fireEvent.click(screen.getByRole("button", { name: /Batch over selected worksheets/ }));
const run = () => fireEvent.click(screen.getByRole("button", { name: "Run Background estimate batch" }));
const finished = () => waitFor(() => expect(useApp.getState().status).toMatch(/batch finished/));
const savedRows = () => (register.mock.calls[0]![0] as AnalysisResult).tables![0]!.rows as unknown[][];

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisSelection.setState({ toolId: null, selection: null });
  usePendingOps.setState({ ops: [] });
  vi.mocked(subtractMagBackground).mockResolvedValue({ corrected: [], slope: 0.5, intercept: 2 });
  vi.mocked(subtractHysteresisBackground).mockResolvedValue({ corrected: [], slope: 1e-5, offset: 0.1 });
});

describe("Background estimate batch", () => {
  it("estimates each worksheet by its own axis, writes no worksheet, and lists unusable ones with a reason", async () => {
    setup([sheet("a", MT), sheet("h", MH), sheet("u", UNKNOWN), sheet("n", NOCHAN)]);
    render(<MagToolsPanel />);
    openBatch();
    run();
    await finished();
    const rows = savedRows();
    expect(rows.map((r) => r[1])).toEqual(["Completed", "Completed", "Failed", "Failed"]);
    expect(rows[0]!.slice(3, 9)).toEqual(["M(T) tail", 0.5, 2, null, 4, 0]);
    expect(rows[1]!.slice(3, 9)).toEqual(["M(H) loop", 1e-5, null, 0.1, 4, 0]);
    expect(rows[2]!.at(-1)).toMatch(/Cannot tell M\(T\) from M\(H\)/);
    expect(rows[3]!.at(-1)).toMatch(/No column named "Moment"/);
    expect(vi.mocked(subtractMagBackground).mock.calls[0]![0]).toMatchObject({ temperature: [10, 20, 30, 40], moment: [1, 2, 3, 4], auto_fraction: 0.1 });
    expect(vi.mocked(subtractHysteresisBackground).mock.calls[0]![0]).toMatchObject({ hi_fraction: 0.7 });
    // Estimate only: no worksheet was added.
    expect(useApp.getState().datasets).toHaveLength(4);
    expect(register.mock.calls[0]![0].parameters).toMatchObject({ toolId: "mag-background", channel: "Moment", mode: "auto" });
  });

  it("an explicit data type applies to every worksheet, and a no-op loop fit is warned", async () => {
    vi.mocked(subtractHysteresisBackground).mockResolvedValue({ corrected: [], slope: 0, offset: 0 });
    setup([sheet("a", MT), sheet("u", UNKNOWN)]);
    render(<MagToolsPanel />);
    fireEvent.change(screen.getByLabelText("Data type"), { target: { value: "mh" } });
    openBatch();
    run();
    await finished();
    expect(vi.mocked(subtractMagBackground)).not.toHaveBeenCalled();
    const rows = savedRows();
    expect(rows.map((r) => r[1])).toEqual(["Completed", "Completed"]);
    expect(String(rows[0]!.at(-1))).toMatch(/No high-field background found/);
  });

  it("is blocked while the plot X is a data column (the single run follows it; the batch reads each worksheet's own axis)", () => {
    setup([sheet("a", mk("Time", "s", [1, 2, 3, 4], ["Temperature", "Moment"])), sheet("b", MT)]);
    useApp.setState({ xKey: 0, yKeys: [1] });
    render(<MagToolsPanel />);
    openBatch();
    expect(screen.getByRole("button", { name: "Run Background estimate batch" })).toBeDisabled();
    expect(screen.getAllByText(/set the plot X to the worksheet's X axis/).length).toBeGreaterThan(0);
  });

  it("changing the high-field fraction starts a fresh table for an M(H) batch", async () => {
    setup([sheet("h", MH), sheet("g", MH)]);
    useApp.setState({ activeId: "h" });
    render(<MagToolsPanel />);
    fireEvent.change(screen.getByLabelText("Data type"), { target: { value: "mh" } });
    openBatch();
    run();
    await finished();
    await waitFor(() => expect(screen.getAllByText("Completed").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("High-field fraction"), { target: { value: "0.5" } });
    await waitFor(() => expect(screen.queryByText("Completed")).toBeNull());
  });

  // Owner decision 2026-11-23: a batch row equals the single fit for that sheet.
  it("uses every worksheet row, so a sheet with excluded rows sends the same request as the single fit", async () => {
    vi.mocked(subtractMagBackground).mockResolvedValue({ corrected: [1, 2, 3, 4], slope: 0.5, intercept: 2 });
    setup([{ ...sheet("a", MT), excludedRows: [0] }, sheet("b", MT)]);
    render(<MagToolsPanel />);
    openBatch();
    run();
    await finished();
    fireEvent.click(screen.getByRole("button", { name: /Subtract background/ }));
    await waitFor(() => expect(useApp.getState().datasets.length).toBe(3));
    const calls = vi.mocked(subtractMagBackground).mock.calls;
    expect(calls).toHaveLength(3); // batch a, batch b, single a
    expect(calls[0]![0]).toEqual(calls[2]![0]);
    expect(calls[0]![0]).toMatchObject({ temperature: [10, 20, 30, 40], moment: [1, 2, 3, 4] });
    expect(savedRows()[0]!.slice(4, 6)).toEqual([0.5, 2]);
    expect(savedRows()[0]![2]).toBe(4); // Rows: every worksheet row, not the analysis view's 3
  });

  it("a response with a channel role is an error row, never another column's fit", async () => {
    const two = mk("Temperature", "K", [10, 20, 30, 40], ["Aux", "Moment"]);
    setup([sheet("a", MT), { ...sheet("b", two), channelRoles: { 1: "ignore" as const } }]);
    render(<MagToolsPanel />);
    openBatch();
    run();
    await finished();
    const rows = savedRows();
    expect(rows.map((r) => r[1])).toEqual(["Completed", "Failed"]);
    expect(String(rows[1]!.at(-1))).toMatch(/channel role|No column|cannot be fitted/);
    expect(vi.mocked(subtractMagBackground)).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh table when the fraction changes", async () => {
    setup([sheet("a", MT), sheet("b", MT)]);
    render(<MagToolsPanel />);
    openBatch();
    run();
    await finished();
    await waitFor(() => expect(screen.getAllByText("Completed").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("High-T fraction"), { target: { value: "0.2" } });
    await waitFor(() => expect(screen.queryByText("Completed")).toBeNull());
  });
});
