// Curie-Weiss batch over selected worksheets (lane BY3): molar susceptibility
// only, the panel's K window, name-matched response, fail closed per worksheet.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { magneticCurieWeissDataFit } from "../../../lib/api/magnetic";
import type { CurieWeissDataFitResult } from "../../../lib/api/magnetic";
import type { DataStruct, Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import CurieWeissPane from "./CurieWeissPane";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api/magnetic", () => ({ magneticCurieWeissDataFit: vi.fn() }));

const chi = (labels: string[], units: string[], values: number[][], meta: Record<string, unknown> = {}): DataStruct => ({
  time: [100, 200, 300, 400], values, labels, units,
  metadata: { x_column_name: "Temperature", x_column_unit: "K", ...meta },
});
const MOLAR = chi(["Chi", "Other"], ["cm3/mol", ""], [[0.04, 1], [0.02, 1], [0.013, 1], [0.01, 1]]);
const FLIPPED = chi(["Other", "Chi"], ["", "cm3/mol"], [[1, 0.04], [1, 0.02], [1, 0.013], [1, 0.01]]);
const MOMENT = chi(["Chi"], ["emu"], [[0.04], [0.02], [0.013], [0.01]]);
const CELSIUS = chi(["Chi"], ["cm3/mol"], [[0.04], [0.02], [0.013], [0.01]], { x_column_unit: "degC" });
const sheet = (id: string, data: DataStruct): Dataset => ({ id, name: `${id}.dat`, data });

const fitResult: CurieWeissDataFitResult = {
  theta_cw: 50, C: 4, mu_eff: 5.66, fit_line: [0.25, -12.5], r2: 0.999, inv_chi: [], susceptibility_molar: [],
  susceptibility_errors_molar: [], inverse_errors: [], fit_inv_chi: [], fit_mask: [], n_fit: 3,
  fit_range_used: [200, 400], excluded_nonpositive: 0,
};

function setup(datasets: Dataset[]) {
  useApp.setState({
    datasets, activeId: "a", selectedIds: datasets.map((d) => d.id), xKey: null, yKeys: null, seriesOrder: null,
    errKeys: {}, selection: null, analysisResults: [], history: [], future: [], status: "",
    resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
  });
}
const openBatch = () => fireEvent.click(screen.getByRole("button", { name: /Batch over selected worksheets/ }));
const run = () => fireEvent.click(screen.getByRole("button", { name: "Run Curie–Weiss batch" }));
const savedRows = () => (register.mock.calls[0]![0] as AnalysisResult).tables![0]!.rows as unknown[][];
const finished = () => waitFor(() => expect(useApp.getState().status).toMatch(/batch finished/));

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisSelection.setState({ toolId: null, selection: null });
  usePendingOps.setState({ ops: [] });
  vi.mocked(magneticCurieWeissDataFit).mockResolvedValue(fitResult);
});

describe("Curie-Weiss batch", () => {
  it("fits each worksheet's same-named molar susceptibility over the panel's window; others are error rows", async () => {
    setup([sheet("a", MOLAR), sheet("b", FLIPPED), sheet("m", MOMENT), sheet("c", CELSIUS)]);
    render(<CurieWeissPane />);
    expect(useAnalysisSelection.getState().toolId).toBeNull();
    openBatch();
    run();
    await finished();
    const rows = savedRows();
    expect(rows.map((r) => r[1])).toEqual(["Completed", "Completed", "Failed", "Failed"]);
    expect(rows[0]!.slice(3, 8)).toEqual([50, 4, 5.66, 0.999, 3]);
    expect(rows[2]!.at(-1)).toMatch(/needs molar susceptibility/);
    expect(rows[3]!.at(-1)).toMatch(/requires absolute temperature in K|not a declared temperature/);
    expect(vi.mocked(magneticCurieWeissDataFit).mock.calls[1]![0]).toMatchObject({
      response: [0.04, 0.02, 0.013, 0.01], temperature: [100, 200, 300, 400], response_basis: "molar_susceptibility", fit_range: [200, 400],
    });
    expect(register.mock.calls[0]![0].parameters).toMatchObject({ toolId: "curie-weiss", channel: "Chi" });
  });

  it("is blocked when the panel's response is a raw moment (its sample mass belongs to one sample)", () => {
    setup([sheet("a", MOMENT), sheet("b", MOMENT)]);
    render(<CurieWeissPane />);
    openBatch();
    expect(screen.getByRole("button", { name: "Run Curie–Weiss batch" })).toBeDisabled();
    expect(screen.getAllByText(/belong to one sample/).length).toBeGreaterThan(0);
  });

  it("cancels between worksheets, and starts a fresh table when the fit window changes", async () => {
    setup([sheet("a", MOLAR), sheet("b", FLIPPED)]);
    let release!: () => void;
    vi.mocked(magneticCurieWeissDataFit).mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(fitResult); }));
    render(<CurieWeissPane />);
    openBatch();
    run();
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));
    usePendingOps.getState().ops[0]!.cancel?.();
    release();
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(savedRows().map((r) => r[1])).toEqual(["Completed", "Cancelled"]);
    await waitFor(() => expect(screen.getAllByText("Completed").length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText("Fit T minimum"), { target: { value: "150" } });
    await waitFor(() => expect(screen.queryByText("Completed")).toBeNull());
  });
});
