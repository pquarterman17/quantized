// Batch over selected worksheets for FFT thickness, Reflectivity FFT and
// Pawley (lane BY3): name-matched columns, per-worksheet error rows, the
// single run's own request, cancel, and the settings reset.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { fftThickness, pawleyRefine, reflectivityFft } from "../../../lib/api/reductions";
import type { PawleyResult } from "../../../lib/reductionTypes";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import FftThicknessSection from "./FftThicknessSection";
import PawleySection from "./PawleySection";
import ReflectivityFftSection from "./ReflectivityFftSection";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api/reductions", () => ({
  fftThickness: vi.fn(), reflectivityFft: vi.fn(), pawleyRefine: vi.fn(),
  xrdPhases: vi.fn(async () => ({ phases: [], default_wavelength: 1.5406 })),
}));

const scan = (labels: string[], values: number[][], metadata: Record<string, unknown> = {}): DataStruct => ({
  time: [20, 30, 40, 50], values, labels, units: labels.map(() => ""),
  metadata: { x_column_name: "2-Theta", x_column_unit: "deg", ...metadata },
});
const A = scan(["Intensity", "Other"], [[1, 9], [2, 8], [3, 7], [4, 6]]);
const B = scan(["Other", "Intensity"], [[9, 10], [8, 20], [7, 30], [6, 40]]);
const C = scan(["Counts"], [[1], [2], [3], [4]]);
const MO = scan(["Intensity"], [[1], [2], [3], [4]], { wavelength_a: 0.7093 });
const sheet = (id: string, data: DataStruct): Dataset => ({ id, name: `${id}.xy`, data });

function setup(datasets: Dataset[]) {
  useApp.setState({
    datasets, activeId: "a", selectedIds: datasets.map((d) => d.id), xKey: null, yKeys: [0], seriesOrder: null,
    errKeys: {}, selection: null, analysisResults: [], history: [], future: [], status: "",
    resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
  });
}
const openBatch = () => fireEvent.click(screen.getByRole("button", { name: /Batch over selected worksheets/ }));
const run = (label: string) => fireEvent.click(screen.getByRole("button", { name: `Run ${label} batch` }));
const savedRows = () => (register.mock.calls[0]![0] as AnalysisResult).tables![0]!.rows as unknown[][];
const finished = () => waitFor(() => expect(useApp.getState().status).toMatch(/batch finished/));

const fftResult = { thickness_nm: 50, uncertainty_nm: 2, wavelength_a: 1.5406, two_theta_range: [20, 50] as [number, number], fft_magnitude: [], thickness_axis: [], n_points: 4 };
const pawleyResult: PawleyResult = {
  cell: [5.42, 5.42, 5.42, 90, 90, 90], cell_initial: [5.43, 5.43, 5.43, 90, 90, 90], scale: null, peaks: [],
  background: [], model: [], residual: [], rwp: 0.05, rwp_initial: 0.2, rwp_background: 0.5, converged: true,
  tie: "abc", hkl_max: 8, n_peaks: 7,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAnalysisSelection.setState({ toolId: null, selection: null });
  usePendingOps.setState({ ops: [] });
  vi.mocked(fftThickness).mockResolvedValue(fftResult);
  vi.mocked(pawleyRefine).mockResolvedValue(pawleyResult);
  vi.mocked(reflectivityFft).mockResolvedValue({
    thicknesses_nm: [30, 60], amplitudes: [1, 0.5], harmonic_labels: ["", ""], q_range: [0, 1], preprocess: "logR",
    fft_magnitude: [], thickness_axis: [], is_neutron: false,
    superlattice: { detected: false, bilayer_period_nm: null, total_thickness_nm: null, n_repeats: null, sublayer_a_nm: null, sublayer_b_nm: null, suppressed_orders: [] },
  });
});

describe("FFT thickness batch", () => {
  it("claims no selection until opened; reads each worksheet's same-named channel with the single run's request", async () => {
    setup([sheet("a", A), sheet("b", B), sheet("c", C)]);
    render(<FftThicknessSection />);
    expect(useAnalysisSelection.getState().toolId).toBeNull();
    openBatch();
    expect(useAnalysisSelection.getState().toolId).toBe("fft-thickness");
    run("FFT thickness");
    await finished();
    expect(savedRows().map((r) => r.slice(0, 5))).toEqual([
      ["a.xy", "Completed", 4, 50, 2],
      ["b.xy", "Completed", 4, 50, 2],
      ["c.xy", "Failed", 4, null, null],
    ]);
    expect(savedRows()[2]!.at(-1)).toBe('No column named "Intensity" in this worksheet.');
    // b lays Intensity out second: its request carries b's own column.
    expect(vi.mocked(fftThickness).mock.calls[1]![0]).toMatchObject({ intensity: [10, 20, 30, 40], wavelength_a: 1.5406, window: "hann", max_thickness_nm: 200 });
    expect(register.mock.calls[0]![0].parameters).toMatchObject({ toolId: "fft-thickness", channel: "Intensity", wavelength: 1.5406 });
  });

  it("fails a worksheet that records another wavelength instead of running it with this one", async () => {
    setup([sheet("a", A), sheet("m", MO)]);
    render(<FftThicknessSection />);
    openBatch();
    run("FFT thickness");
    await finished();
    expect(savedRows()[1]!.slice(0, 2)).toEqual(["m.xy", "Failed"]);
    expect(savedRows()[1]!.at(-1)).toMatch(/records a wavelength of 0.7093/);
    expect(fftThickness).toHaveBeenCalledTimes(1);
  });

  it("leaves a backend failure on one worksheet as an error row and goes on", async () => {
    vi.mocked(fftThickness).mockRejectedValueOnce(new Error("too few fringes"));
    setup([sheet("a", A), sheet("b", B)]);
    render(<FftThicknessSection />);
    openBatch();
    run("FFT thickness");
    await finished();
    expect(savedRows().map((r) => r[1])).toEqual(["Failed", "Completed"]);
    expect(savedRows()[0]!.at(-1)).toBe("too few fringes");
  });

  it("drops the finished table when a setting changes", async () => {
    setup([sheet("a", A)]);
    render(<FftThicknessSection />);
    openBatch();
    run("FFT thickness");
    await finished();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("200"), { target: { value: "300" } });
    expect(screen.queryByText("Completed")).toBeNull();
  });

  it("cancels between worksheets", async () => {
    setup([sheet("a", A), sheet("b", B)]);
    let release!: () => void;
    vi.mocked(fftThickness).mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(fftResult); }));
    render(<FftThicknessSection />);
    openBatch();
    run("FFT thickness");
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));
    usePendingOps.getState().ops[0]!.cancel?.();
    release();
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(savedRows().map((r) => r[1])).toEqual(["Completed", "Cancelled"]);
  });
});

describe("Reflectivity FFT batch", () => {
  const R = (extra: Record<string, unknown> = {}) => scan(["R"], [[1], [2], [3], [4]], extra);

  it("runs each worksheet's same-named channel and summarises the thicknesses", async () => {
    setup([sheet("a", R()), sheet("b", R())]);
    render(<ReflectivityFftSection />);
    openBatch();
    run("Reflectivity FFT");
    await finished();
    expect(savedRows().map((r) => r.slice(0, 6))).toEqual([
      ["a.xy", "Completed", 4, 30, 2, "30, 60"],
      ["b.xy", "Completed", 4, 30, 2, "30, 60"],
    ]);
    expect(reflectivityFft).toHaveBeenCalledWith(expect.objectContaining({ is_neutron: false, wavelength_a: 1.5406, preprocess: "logR" }));
  });

  it("fails a worksheet whose axis reads as the other probe", async () => {
    setup([sheet("a", R()), sheet("q", R({ x_column_unit: "1/Å" }))]);
    render(<ReflectivityFftSection />);
    openBatch();
    run("Reflectivity FFT");
    await finished();
    expect(savedRows().map((r) => r[1])).toEqual(["Completed", "Failed"]);
    expect(savedRows()[1]!.at(-1)).toMatch(/reads as Q \(neutron\) but the batch is set to 2θ \(X-ray\)/);
  });
});

describe("Pawley batch", () => {
  it("refines each worksheet from the panel's starting cell and keeps the model out of the Library", async () => {
    setup([sheet("a", A), sheet("b", B)]);
    render(<PawleySection />);
    openBatch();
    run("Pawley");
    await finished();
    expect(savedRows().map((r) => r.slice(0, 9))).toEqual([
      ["a.xy", "Completed", 4, 5.42, 5.42, 5.42, 0.05, 0.5, 7],
      ["b.xy", "Completed", 4, 5.42, 5.42, 5.42, 0.05, 0.5, 7],
    ]);
    expect(vi.mocked(pawleyRefine).mock.calls[1]![0]).toMatchObject({
      intensity: [10, 20, 30, 40], a: 5.43, symmetry: "P", tie: "abc", wavelength: 1.5406, refine_cell: true, min_two_theta: 20, max_two_theta: 50,
    });
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("fails closed per worksheet: a non-2θ axis, a different wavelength, a missing channel", async () => {
    setup([
      sheet("a", A),
      sheet("q", scan(["Intensity"], [[1], [2], [3], [4]], { x_column_name: "Qz", x_column_unit: "1/Ang" })),
      sheet("m", MO),
      sheet("c", C),
    ]);
    render(<PawleySection />);
    openBatch();
    run("Pawley");
    await finished();
    expect(savedRows().map((r) => r[1])).toEqual(["Completed", "Failed", "Failed", "Failed"]);
    expect(savedRows()[1]!.at(-1)).toMatch(/not 2θ in degrees/);
    expect(savedRows()[2]!.at(-1)).toMatch(/records a wavelength of 0.7093/);
    expect(savedRows()[3]!.at(-1)).toMatch(/No column named "Intensity"/);
    expect(pawleyRefine).toHaveBeenCalledTimes(1);
  });

  it("warns with the single run's verdict on a weak fit and blocks on an unphysical cell", async () => {
    vi.mocked(pawleyRefine).mockResolvedValue({ ...pawleyResult, rwp: 0.45 });
    setup([sheet("a", A)]);
    render(<PawleySection />);
    openBatch();
    run("Pawley");
    await finished();
    expect(savedRows()[0]!.at(-1)).toMatch(/explain little beyond the background/);
    fireEvent.change(screen.getByLabelText("a (Å)"), { target: { value: "-1" } });
    expect(screen.getByRole("button", { name: "Run Pawley batch" })).toBeDisabled();
  });
});

describe("worksheet checks that fail closed (review round)", () => {
  it("FFT thickness: a worksheet whose x is not 2θ in degrees is an error row", async () => {
    setup([sheet("a", A), sheet("q", scan(["Intensity"], [[1], [2], [3], [4]], { x_column_name: "Qz", x_column_unit: "1/Ang" }))]);
    render(<FftThicknessSection />);
    openBatch();
    run("FFT thickness");
    await finished();
    expect(savedRows().map((r) => r[1])).toEqual(["Completed", "Failed"]);
    expect(savedRows()[1]!.at(-1)).toMatch(/not 2θ in degrees/);
    expect(fftThickness).toHaveBeenCalledTimes(1);
  });

  it("Reflectivity FFT: an x range typed in another unit than the worksheet's is an error row", async () => {
    const { reflectivityFftBatchItem } = await import("./reductionBatchItems");
    const settings = { isNeutron: true, wavelength: 1.5406, xMin: 0.02, xMax: null, windowFn: "hann", preprocess: "logR" as const, maxThicknessNm: 500, peakProminence: 0.05 };
    const nm = { id: "n", name: "n.xy", data: scan(["R"], [[1], [2], [3], [4]], { x_column_unit: "1/nm" }) };
    await expect(reflectivityFftBatchItem(nm, "R", settings, "1/ang")).rejects.toThrow(/x range was set in "1\/ang"/);
    expect(reflectivityFft).not.toHaveBeenCalled();
    await expect(reflectivityFftBatchItem(nm, "R", { ...settings, xMin: null }, "1/ang")).resolves.toBeTruthy();
  });
});
