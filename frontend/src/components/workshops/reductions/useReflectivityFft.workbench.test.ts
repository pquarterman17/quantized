// Reflectivity FFT "Out of date" (lane WB6): same contract as FFT thickness.
// The result is stamped with the settings and source rows its run launched
// with; a change marks it and withholds → Library; a late answer for a
// dataset the user left is dropped; a lazy book resolves before the run.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reflectivityFft } from "../../../lib/api/reductions";
import type { ReflectivityFftResult } from "../../../lib/reductionTypes";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
import { useReflectivityFft } from "./useReflectivityFft";

vi.mock("../../../lib/api/reductions", () => ({ reflectivityFft: vi.fn() }));

const scan: DataStruct = { time: [0.01, 0.05, 0.09, 0.12], values: [[1], [0.5], [0.2], [0.1]], labels: ["R"], units: [""], metadata: {} };
const RES: ReflectivityFftResult = {
  thicknesses_nm: [30], amplitudes: [1], harmonic_labels: [""], q_range: [0, 1], preprocess: "logR",
  fft_magnitude: [0, 1], thickness_axis: [0, 10], is_neutron: false,
  superlattice: { detected: false, bilayer_period_nm: null, total_thickness_nm: null, n_repeats: null, sublayer_a_nm: null, sublayer_b_nm: null, suppressed_orders: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  vi.mocked(reflectivityFft).mockResolvedValue(RES);
  useApp.setState({ datasets: [{ id: "d1", name: "xrr.dat", data: scan }], activeId: "d1", status: "", history: [], future: [] });
});

async function computed() {
  const hook = renderHook(() => useReflectivityFft());
  await act(async () => { await hook.result.current.compute(); });
  return hook;
}

describe("Reflectivity FFT out-of-date state", () => {
  it("characterization: a fresh result is current and → Library adds the spectrum", async () => {
    const { result } = await computed();
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(false);
    act(() => result.current.toLibrary());
    expect(useApp.getState().datasets).toHaveLength(2);
  });

  it("a changed setting marks it and withholds → Library; changing it back restores it", async () => {
    const { result } = await computed();
    act(() => result.current.setPreprocess("none"));
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(true);
    act(() => result.current.toLibrary());
    expect(useApp.getState().datasets).toHaveLength(1); // fail-before: it added the spectrum
    act(() => result.current.setPreprocess("logR"));
    expect(result.current.stale).toBe(false);
  });

  it("each setting marks it: wavelength, range, window, thickness, prominence", async () => {
    for (const change of [
      (h: ReturnType<typeof useReflectivityFft>) => h.setWavelength(1.79),
      (h: ReturnType<typeof useReflectivityFft>) => h.setXMin(0.02),
      (h: ReturnType<typeof useReflectivityFft>) => h.setXMax(0.1),
      (h: ReturnType<typeof useReflectivityFft>) => h.setWindowFn("blackman"),
      (h: ReturnType<typeof useReflectivityFft>) => h.setMaxThicknessNm(100),
      (h: ReturnType<typeof useReflectivityFft>) => h.setPeakProminence(0.2),
    ]) {
      const { result } = await computed();
      act(() => change(result.current));
      expect(result.current.stale).toBe(true);
    }
  });

  it("edited source rows mark it out of date", async () => {
    const { result } = await computed();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, excludedRows: [1] })) })));
    expect(result.current.stale).toBe(true);
  });

  it("forced race: a setting changed in flight lands out of date; an answer for a left dataset is dropped", async () => {
    let land!: (r: ReflectivityFftResult) => void;
    vi.mocked(reflectivityFft).mockImplementationOnce(() => new Promise((r) => { land = r; }));
    const { result } = renderHook(() => useReflectivityFft());
    let pending!: Promise<void>;
    act(() => { pending = result.current.compute(); });
    await act(async () => {});
    act(() => result.current.setWindowFn("blackman"));
    await act(async () => { land(RES); await pending; });
    expect(result.current.stale).toBe(true); // fail-before: current
    act(() => result.current.clear());

    vi.mocked(reflectivityFft).mockImplementationOnce(() => new Promise((r) => { land = r; }));
    act(() => { pending = result.current.compute(); });
    await act(async () => {});
    act(() => useApp.setState((s) => ({ datasets: [...s.datasets, { id: "d2", name: "b.dat", data: scan }], activeId: "d2" })));
    await act(async () => { land(RES); await pending; });
    expect(result.current.result).toBeNull(); // fail-before: d1's result showed on d2
  });

  it("a lazy book is resolved before the run, so the fresh result is current", async () => {
    makePending({ id: "d1", name: "xrr.dat", data: scan });
    const { result } = await computed();
    expect(result.current.result).not.toBeNull();
    expect(result.current.stale).toBe(false);
  });
});
