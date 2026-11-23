// RSM fail-closed acceptance (OPEN_ITEMS row 14): a lazy book that cannot be
// resolved, non-finite peak centres, and Clear during a run each end in a
// message or in nothing landing.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeRsm, rsmBoxCut, rsmStrain } from "../../../lib/api/rsm";
import type { DataStruct, RsmPeak } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { restoreResolve } from "../workbench/pendingBook.testkit";
import { useRsm } from "./useRsm";

vi.mock("../../../lib/api/rsm", () => ({ analyzeRsm: vi.fn(), rsmBoxCut: vi.fn(), rsmStrain: vi.fn() }));

const RSM: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[60, 30, 100, 0.5, 4.0], [61, 30, 200, 0.45, 3.9], [60, 31, 150, 0.4, 4.1], [61, 31, 300, 0.42, 3.8]],
  labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
  units: ["deg", "deg", "cps", "Ang^-1", "Ang^-1"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
};
const peak = (rank: number, cls: string, q: [number, number]): RsmPeak => ({
  rank, classification: cls, centre_angle: [30, 60], centre_Q: q, fwhm_angle: [0.1, 0.2], fwhm_Q: [0.01, 0.02], amplitude: 100, background: 1,
});
const found = (peaks: RsmPeak[]) => ({ peaks, n_peaks_found: peaks.length, intensity_unit: "cps", used_q_space: true });

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  useApp.setState({ datasets: [{ id: "d1", name: "rsm.xrdml", data: RSM }], activeId: "d1", mapRoi: null, mapRuler: null, rsmPeaks: null });
});

describe("RSM refusals", () => {
  it("lazy preview: Find peaks says so when the full dataset cannot be resolved", async () => {
    useApp.setState({ resolveDataset: () => Promise.resolve(undefined) });
    const { result } = renderHook(() => useRsm());
    await act(async () => { await result.current.analyze(); });
    expect(result.current.error).toMatch(/full dataset is unavailable/i);
    expect(analyzeRsm).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("lazy preview: a peak cut says so when the full dataset cannot be resolved", async () => {
    vi.mocked(analyzeRsm).mockResolvedValue(found([peak(1, "substrate", [0.5, 4.0]), peak(2, "film", [0.4, 3.8])]));
    const { result } = renderHook(() => useRsm());
    await act(async () => { await result.current.analyze(); });
    useApp.setState({ resolveDataset: () => Promise.resolve(undefined) });
    await act(async () => { await result.current.radialCut(peak(2, "film", [0.4, 3.8])); });
    expect(result.current.error).toMatch(/full dataset is unavailable/i);
    expect(rsmBoxCut).not.toHaveBeenCalled();
    expect(useApp.getState().datasets).toHaveLength(1);
  });

  it("non-finite: strain with a NaN peak centre is refused with a message", async () => {
    vi.mocked(analyzeRsm).mockResolvedValue(found([peak(1, "substrate", [Number.NaN, 4.0]), peak(2, "film", [0.4, 3.8])]));
    const { result } = renderHook(() => useRsm());
    await act(async () => { await result.current.analyze(); });
    await act(async () => { await result.current.computeStrain(); });
    expect(result.current.error).toMatch(/finite Q-space centres/);
    expect(rsmStrain).not.toHaveBeenCalled();
  });

  it("too few rows: zero peaks found says so", async () => {
    vi.mocked(analyzeRsm).mockResolvedValue(found([]));
    const { result } = renderHook(() => useRsm());
    await act(async () => { await result.current.analyze(); });
    expect(result.current.error).toBe("No peaks found above threshold.");
  });

  it("cancel: Clear while peaks are being found drops the late answer", async () => {
    let finish!: (v: ReturnType<typeof found>) => void;
    vi.mocked(analyzeRsm).mockReturnValue(new Promise((r) => { finish = r; }));
    const { result } = renderHook(() => useRsm());
    let run!: Promise<void>;
    await act(async () => { run = result.current.analyze(); await Promise.resolve(); });
    act(() => result.current.clear());
    await act(async () => { finish(found([peak(1, "film", [0.4, 3.8])])); await run; });
    expect(result.current.peaks).toBeNull();
    expect(useApp.getState().rsmPeaks).toBeNull();
    expect(result.current.busy).toBe(false);
  });
});
