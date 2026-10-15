import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { williamsonHall } from "../../../lib/api/reductions";
import type { PeakTable } from "../../../lib/peakTable";
import { williamsonHallPeakTableFingerprint } from "../../../lib/williamsonHallRecipe";
import { useWilliamsonHall } from "./useWilliamsonHall";
import { useApp } from "../../../store/useApp";
import { useWilliamsonHallRequestStore } from "../../../store/williamsonHall";

vi.mock("../../../lib/api/reductions", () => ({
  williamsonHall: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "xrd", name: "film.xrdml", data: {
      time: [30, 45], values: [[100], [80]], labels: ["Intensity"], units: ["cps"], metadata: {},
    } }], activeId: "xrd", analysisResults: [], openAnalysisResultId: null, history: [], future: [],
  });
  useWilliamsonHallRequestStore.setState({ request: null });
});

describe("useWilliamsonHall", () => {
  it("starts with 2 empty peak rows and compute disabled", () => {
    const { result } = renderHook(() => useWilliamsonHall());
    expect(result.current.rows).toEqual([
      { twoTheta: 0, fwhm: 0 },
      { twoTheta: 0, fwhm: 0 },
    ]);
    expect(result.current.canCompute).toBe(false);
  });

  it("adds, updates, and removes rows", () => {
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => result.current.addRow());
    expect(result.current.rows).toHaveLength(3);

    act(() => result.current.updateRow(0, { twoTheta: 30.1, fwhm: 0.25 }));
    expect(result.current.rows[0]).toEqual({ twoTheta: 30.1, fwhm: 0.25 });

    act(() => result.current.removeRow(2));
    expect(result.current.rows).toHaveLength(2);
  });

  it("rejects out-of-range peaks from canCompute", () => {
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => {
      result.current.updateRow(0, { twoTheta: 200, fwhm: 0.2 }); // >= 180
      result.current.updateRow(1, { twoTheta: 40, fwhm: 0.3 });
    });
    expect(result.current.canCompute).toBe(false);
  });

  it("computes with valid rows and maps the result", async () => {
    vi.mocked(williamsonHall).mockResolvedValue({
      grain_size_nm: 42,
      microstrain: 0.001,
      r2: 0.98,
      plot_x: [0.35, 0.69],
      plot_y: [0.01, 0.02],
      fit_line: [0.001, 0.05],
    });
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => {
      result.current.updateRow(0, { twoTheta: 30.1, fwhm: 0.25 });
      result.current.updateRow(1, { twoTheta: 43.2, fwhm: 0.28 });
    });
    expect(result.current.canCompute).toBe(true);

    await act(async () => {
      await result.current.compute();
    });

    expect(williamsonHall).toHaveBeenCalledWith({
      two_theta_deg: [30.1, 43.2],
      fwhm_deg: [0.25, 0.28],
      wavelength_a: 1.5406,
      k_factor: 0.9,
      instrumental_broadening_deg: 0,
    });
    expect(result.current.result?.grain_size_nm).toBe(42);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a validation message and skips the API call when rows are invalid", async () => {
    const { result } = renderHook(() => useWilliamsonHall());
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.error).toMatch(/at least 2 valid peaks/);
    expect(williamsonHall).not.toHaveBeenCalled();
  });

  it("surfaces the API's error message", async () => {
    vi.mocked(williamsonHall).mockRejectedValue(new Error("bad wavelength"));
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => {
      result.current.updateRow(0, { twoTheta: 30, fwhm: 0.2 });
      result.current.updateRow(1, { twoTheta: 40, fwhm: 0.3 });
    });
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.error).toBe("bad wavelength");
    expect(result.current.result).toBeNull();
  });

  it("clear() drops the result and error", async () => {
    vi.mocked(williamsonHall).mockResolvedValue({
      grain_size_nm: 10, microstrain: 0, r2: 1, plot_x: [], plot_y: [], fit_line: [0, 0],
    });
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => {
      result.current.updateRow(0, { twoTheta: 30, fwhm: 0.2 });
      result.current.updateRow(1, { twoTheta: 40, fwhm: 0.3 });
    });
    await act(async () => {
      await result.current.compute();
    });
    expect(result.current.result).not.toBeNull();
    act(() => result.current.clear());
    expect(result.current.result).toBeNull();
  });

  it("invalidates a completed fit on every input edit and ignores a late response", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof williamsonHall>>) => void;
    vi.mocked(williamsonHall).mockReturnValue(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => {
      result.current.updateRow(0, { twoTheta: 30, fwhm: 0.2 });
      result.current.updateRow(1, { twoTheta: 45, fwhm: 0.3 });
    });
    let pending!: Promise<void>;
    act(() => { pending = result.current.compute(); });
    act(() => result.current.setKFactor(0.95));
    await act(async () => {
      resolve({ grain_size_nm: 12, microstrain: 0.01, r2: 0.9,
        plot_x: [1, 2], plot_y: [1, 2], fit_line: [1, 0] });
      await pending;
    });
    expect(result.current.result).toBeNull();
    expect(result.current.canSaveResult).toBe(false);
  });

  it("publishes one durable result and restores its exact recipe for editing", async () => {
    vi.mocked(williamsonHall).mockResolvedValue({ grain_size_nm: 42, microstrain: 0.001, r2: 0.98,
      plot_x: [1, 2], plot_y: [0.01, 0.02], fit_line: [0.01, 0.001] });
    const { result, unmount } = renderHook(() => useWilliamsonHall());
    act(() => {
      result.current.updateRow(0, { twoTheta: 30, fwhm: 0.2 });
      result.current.updateRow(1, { twoTheta: 45, fwhm: 0.3 });
      result.current.setInstrumentalBroadening(0.05);
    });
    await act(async () => { await result.current.compute(); });
    act(() => { result.current.saveResult(); result.current.saveResult(); });
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().analysisResults[0]).toMatchObject({
      producer: { id: "williamson-hall" }, parameters: { recipe: { instrumentalBroadeningDeg: 0.05 } },
    });
    const recipe = useApp.getState().analysisResults[0].parameters!.recipe as never;
    unmount();
    useWilliamsonHallRequestStore.getState().openWith(recipe);
    const reopened = renderHook(() => useWilliamsonHall());
    expect(reopened.result.current.rows).toEqual([{ twoTheta: 30, fwhm: 0.2 }, { twoTheta: 45, fwhm: 0.3 }]);
    expect(reopened.result.current.instrumentalBroadening).toBe(0.05);
  });

  it("keeps a saved peak-table binding when reopening onto another source", async () => {
    const peakTable: PeakTable = {
      version: 1,
      peaks: [
        { id: "p1", center: 30, centerErr: null, fwhm: 0.2, fwhmErr: null, height: 10,
          heightErr: null, area: 2, bg: 1, eta: null, model: "Gaussian", status: "fit", excluded: false },
        { id: "p2", center: 45, centerErr: null, fwhm: 0.3, fwhmErr: null, height: 8,
          heightErr: null, area: 2, bg: 1, eta: null, model: "Gaussian", status: "fit", excluded: false },
      ],
      provenance: { datasetId: "other", datasetName: "other.xrdml", method: "simultaneous",
        model: "Gaussian", bgDegree: 0, linkMode: "None", constrain: false, bgCoeffs: [],
        R2: 0.99, rmse: 0.1, xLabel: "2θ", xUnit: "deg", wavelengthA: 1.5406,
        fingerprint: "other-data", fittedAt: "2026-10-15T00:00:00Z" },
    };
    const other = { id: "other", name: "other.xrdml", peakTable, data: {
      time: [30, 45], values: [[50], [40]], labels: ["Intensity"], units: ["cps"], metadata: {},
    } };
    const { result } = renderHook(() => useWilliamsonHall());
    act(() => {
      useApp.setState((state) => ({ datasets: [...state.datasets, other], activeId: other.id }));
      useWilliamsonHallRequestStore.getState().openWith({
        rows: [{ twoTheta: 30, fwhm: 0.2 }, { twoTheta: 45, fwhm: 0.3 }],
        wavelengthA: 1.5406, kFactor: 0.9, instrumentalBroadeningDeg: 0,
        sourceKind: "peak-table", peakTableFingerprint: williamsonHallPeakTableFingerprint(peakTable),
      });
    });
    expect(result.current.fittedSource).toMatch(/restored/);
    vi.mocked(williamsonHall).mockResolvedValue({ grain_size_nm: 42, microstrain: 0.001, r2: 0.98,
      plot_x: [1, 2], plot_y: [0.01, 0.02], fit_line: [0.01, 0.001] });
    await act(async () => { await result.current.compute(); });
    act(() => { result.current.saveResult(); });
    expect(useApp.getState().analysisResults[0]).toMatchObject({
      parameters: { recipe: { sourceKind: "peak-table" } },
    });
  });
});
