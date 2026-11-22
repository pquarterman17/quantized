// RSM analysis "Out of date" (lane WB7). Find peaks / Compute strain stay
// buttons; a new active dataset still DROPS the analysis (unchanged). New: a
// peak count changed after the peaks were found marks them out of date and
// withholds Compute strain, the strain readout and the peak cuts; an answer
// for a dataset left, or an analysis cleared, in flight lands nowhere.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeRsm, rsmBoxCut, rsmStrain } from "../../../lib/api/rsm";
import type { DataStruct, RsmPeak } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { makePending, restoreResolve } from "../workbench/pendingBook.testkit";
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
const FOUND = {
  peaks: [peak(1, "substrate", [0.5, 4.0]), peak(2, "film", [0.4, 3.8])],
  n_peaks_found: 2, intensity_unit: "cps", used_q_space: true,
};
const STRAIN = {
  eps_parallel: 0.25, eps_perp: 0.05, a_sub_parallel: 12.6, a_sub_perp: 1.57,
  a_film_parallel: 15.7, a_film_perp: 1.65, relaxation: null, warnings: [],
};
const DS = { id: "d1", name: "rsm.xrdml", data: RSM };

beforeEach(() => {
  vi.clearAllMocks();
  restoreResolve();
  vi.mocked(analyzeRsm).mockResolvedValue(FOUND);
  vi.mocked(rsmStrain).mockResolvedValue(STRAIN);
  vi.mocked(rsmBoxCut).mockResolvedValue({ ...RSM });
  useApp.setState({ datasets: [DS], activeId: "d1", mapRoi: null, mapRuler: null, rsmPeaks: null });
});

async function found() {
  const hook = renderHook(() => useRsm());
  await act(async () => { await hook.result.current.analyze(); });
  return hook;
}

describe("RSM analysis out-of-date state", () => {
  it("characterization: fresh peaks are current; strain and cuts are available", async () => {
    const { result } = await found();
    expect(result.current.peaks).toHaveLength(2);
    expect(result.current.stale).toBe(false);
    expect(result.current.cutDisabledReason).toBeNull();
    await act(async () => { await result.current.computeStrain(); });
    expect(result.current.strain?.eps_parallel).toBe(0.25);
  });

  it("characterization: a new active dataset drops the analysis, unmarked", async () => {
    const { result } = await found();
    act(() => useApp.setState({ datasets: [DS, { id: "d2", name: "b.xrdml", data: { ...RSM } }], activeId: "d2" }));
    expect(result.current.peaks).toBeNull();
    expect(result.current.stale).toBe(false);
  });

  it("a changed peak count marks the peaks out of date and withholds strain and cuts", async () => {
    const { result } = await found();
    await act(async () => { await result.current.computeStrain(); });
    act(() => result.current.setNPeaks(3));
    expect(result.current.peaks).not.toBeNull(); // shown, marked
    expect(result.current.stale).toBe(true);
    expect(result.current.cutDisabledReason).toMatch(/Out of date/);
    expect(result.current.defaultCutPeak).toBeNull();
    vi.mocked(rsmStrain).mockClear();
    await act(async () => { await result.current.computeStrain(); });
    await act(async () => { await result.current.radialCut(FOUND.peaks[1]); });
    expect(rsmStrain).not.toHaveBeenCalled(); // fail-before: strain from the old peaks
    expect(rsmBoxCut).not.toHaveBeenCalled(); // fail-before: cut through a peak of the old find
  });

  it("finding again with the new count clears the mark", async () => {
    const { result } = await found();
    act(() => result.current.setNPeaks(3));
    await act(async () => { await result.current.analyze(); });
    expect(result.current.stale).toBe(false);
    expect(analyzeRsm).toHaveBeenLastCalledWith({ dataset: RSM, n_peaks: 3 });
  });

  it("forced race: a count changed while the request runs leaves the landed peaks out of date", async () => {
    let land!: (r: typeof FOUND) => void;
    vi.mocked(analyzeRsm).mockImplementationOnce(() => new Promise((r) => { land = r as never; }));
    const { result } = renderHook(() => useRsm());
    let pending!: Promise<void>;
    act(() => { pending = result.current.analyze(); });
    await act(async () => {});
    act(() => result.current.setNPeaks(4));
    await act(async () => { land(FOUND); await pending; });
    expect(result.current.peaks).not.toBeNull();
    expect(result.current.stale).toBe(true); // fail-before: current
  });

  it("forced race: peaks found for a dataset the user left land nowhere", async () => {
    let land!: (r: typeof FOUND) => void;
    vi.mocked(analyzeRsm).mockImplementationOnce(() => new Promise((r) => { land = r as never; }));
    const { result } = renderHook(() => useRsm());
    let pending!: Promise<void>;
    act(() => { pending = result.current.analyze(); });
    await act(async () => {});
    act(() => useApp.setState({ datasets: [DS, { id: "d2", name: "b.xrdml", data: { ...RSM } }], activeId: "d2" }));
    await act(async () => { land(FOUND); await pending; });
    expect(result.current.peaks).toBeNull(); // fail-before: d1's peaks shown under d2
    expect(useApp.getState().rsmPeaks).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("forced race: Clear while the strain is computing drops the late strain", async () => {
    const { result } = await found();
    let land!: (r: typeof STRAIN) => void;
    vi.mocked(rsmStrain).mockImplementationOnce(() => new Promise((r) => { land = r as never; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.computeStrain(); });
    act(() => result.current.clear());
    await act(async () => { land(STRAIN); await pending; });
    expect(result.current.strain).toBeNull(); // fail-before: strain for cleared peaks
  });

  it("a lazy book is resolved first, so the peaks it finds are current", async () => {
    makePending(DS);
    const { result } = await found();
    expect(result.current.peaks).toHaveLength(2); // fail-before: dropped by the install
    expect(result.current.stale).toBe(false);
  });

  it("takes the peaks off the map overlay while out of date and puts them back when the count is restored", async () => {
    const { result } = await found();
    expect(useApp.getState().rsmPeaks?.datasetId).toBe("d1");
    act(() => result.current.setNPeaks(3));
    expect(useApp.getState().rsmPeaks).toBeNull(); // fail-before: still drawn as current
    act(() => result.current.setNPeaks(2));
    expect(useApp.getState().rsmPeaks?.peaks).toHaveLength(2);
  });

  it("forced race: a failure of a run the user left does not show an error or clear busy", async () => {
    let fail!: (e: Error) => void;
    vi.mocked(analyzeRsm).mockImplementationOnce(() => new Promise((_, rej) => { fail = rej; }));
    const { result } = renderHook(() => useRsm());
    let pending!: Promise<void>;
    act(() => { pending = result.current.analyze(); });
    await act(async () => {});
    act(() => useApp.setState({ datasets: [DS, { id: "d2", name: "b.xrdml", data: { ...RSM } }], activeId: "d2" }));
    await act(async () => { fail(new Error("boom")); await pending; });
    expect(result.current.error).toBeNull(); // fail-before: "boom" under d2
  });
});
