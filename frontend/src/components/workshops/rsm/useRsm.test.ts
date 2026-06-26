import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeRsm, rsmStrain } from "../../../lib/api";
import type { DataStruct, RsmPeak } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { isRsmDataset, strainPair, useRsm } from "./useRsm";

vi.mock("../../../lib/api", () => ({
  analyzeRsm: vi.fn(),
  rsmStrain: vi.fn(),
}));

const RSM: DataStruct = {
  time: [0, 1, 2, 3],
  values: [
    [60, 30, 100, 0.5, 4.0],
    [61, 30, 200, 0.45, 3.9],
    [60, 31, 150, 0.4, 4.1],
    [61, 31, 300, 0.42, 3.8],
  ],
  labels: ["2Theta", "Omega", "Intensity", "Qx", "Qz"],
  units: ["deg", "deg", "cps", "Ang^-1", "Ang^-1"],
  metadata: { is2D: true, map_shape: [2, 2], axis1_name: "Omega" },
};

const NOT_RSM: DataStruct = {
  time: [0, 1],
  values: [[1], [2]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};

function peak(rank: number, cls: string, q: [number, number]): RsmPeak {
  return {
    rank,
    classification: cls,
    centre_angle: [30, 60],
    centre_Q: q,
    fwhm_angle: [0.1, 0.2],
    fwhm_Q: [0.01, 0.02],
    amplitude: 100,
    background: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [{ id: "d1", name: "rsm.xrdml", data: RSM }], activeId: "d1" });
});

describe("isRsmDataset / strainPair", () => {
  it("detects a 2D RSM by is2D + Qx/Qz columns", () => {
    expect(isRsmDataset({ id: "x", name: "n", data: RSM })).toBe(true);
    expect(isRsmDataset({ id: "x", name: "n", data: NOT_RSM })).toBe(false);
    expect(isRsmDataset(null)).toBe(false);
  });

  it("pairs substrate + film Q-centres", () => {
    const pair = strainPair([peak(1, "substrate", [0.5, 4.0]), peak(2, "film", [0.4, 3.8])]);
    expect(pair).toEqual({ sub: [0.5, 4.0], film: [0.4, 3.8] });
  });

  it("returns null when a Q-centre is non-finite", () => {
    expect(strainPair([peak(1, "substrate", [NaN, 4.0]), peak(2, "film", [0.4, 3.8])])).toBeNull();
  });
});

describe("useRsm", () => {
  it("analyzes the active RSM dataset and stores peaks", async () => {
    vi.mocked(analyzeRsm).mockResolvedValue({
      peaks: [peak(1, "substrate", [0.5, 4.0]), peak(2, "film", [0.4, 3.8])],
      n_peaks_found: 2,
      intensity_unit: "cps",
      used_q_space: true,
    });
    const { result } = renderHook(() => useRsm());
    expect(result.current.isRsm).toBe(true);

    await act(async () => {
      await result.current.analyze();
    });

    expect(analyzeRsm).toHaveBeenCalledWith({ dataset: RSM, n_peaks: 2 });
    expect(result.current.peaks).toHaveLength(2);
  });

  it("is a no-op for a non-RSM dataset", async () => {
    useApp.setState({ datasets: [{ id: "d2", name: "m.dat", data: NOT_RSM }], activeId: "d2" });
    const { result } = renderHook(() => useRsm());
    expect(result.current.isRsm).toBe(false);
    await act(async () => {
      await result.current.analyze();
    });
    expect(analyzeRsm).not.toHaveBeenCalled();
  });

  it("computes strain from the substrate/film pair", async () => {
    vi.mocked(analyzeRsm).mockResolvedValue({
      peaks: [peak(1, "substrate", [0.5, 4.0]), peak(2, "film", [0.4, 3.8])],
      n_peaks_found: 2,
      intensity_unit: "cps",
      used_q_space: true,
    });
    vi.mocked(rsmStrain).mockResolvedValue({
      eps_parallel: 0.25,
      eps_perp: 0.0526,
      a_sub_parallel: 12.6,
      a_sub_perp: 1.57,
      a_film_parallel: 15.7,
      a_film_perp: 1.65,
      relaxation: null,
    });
    const { result } = renderHook(() => useRsm());

    await act(async () => {
      await result.current.analyze();
    });
    await act(async () => {
      await result.current.computeStrain();
    });

    expect(rsmStrain).toHaveBeenCalledWith({ q_sub: [0.5, 4.0], q_film: [0.4, 3.8] });
    expect(result.current.strain?.eps_parallel).toBe(0.25);
  });

  it("surfaces an analysis error", async () => {
    vi.mocked(analyzeRsm).mockRejectedValue(new Error("regrid failed"));
    const { result } = renderHook(() => useRsm());
    await act(async () => {
      await result.current.analyze();
    });
    expect(result.current.error).toContain("regrid failed");
    expect(result.current.peaks).toBeNull();
  });
});
