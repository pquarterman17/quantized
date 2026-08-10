import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { analyzeRsm, rsmStrain } from "../../../lib/api";
import { rsmBoxCut } from "../../../lib/api/rsm";
import type { DataStruct, RsmPeak } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { cutTarget, isRsmDataset, strainPair, useRsm } from "./useRsm";

vi.mock("../../../lib/api", () => ({
  analyzeRsm: vi.fn(),
  rsmStrain: vi.fn(),
}));

vi.mock("../../../lib/api/rsm", () => ({
  rsmBoxCut: vi.fn(),
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
  useApp.setState({
    datasets: [{ id: "d1", name: "rsm.xrdml", data: RSM }],
    activeId: "d1",
    mapRoi: null,
    mapRuler: null,
  });
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

// RSM_CUTS_PLAN item 7 — peak-anchored radial/transverse cuts.
describe("cutTarget", () => {
  it("is disabled with a reason when the dataset has no Q columns", () => {
    expect(cutTarget(false, null)).toEqual({ peak: null, reason: "Dataset has no Q columns" });
  });

  it("is disabled with a reason when no peaks have been found yet", () => {
    expect(cutTarget(true, null)).toEqual({ peak: null, reason: "Find peaks first" });
    expect(cutTarget(true, [])).toEqual({ peak: null, reason: "Find peaks first" });
  });

  it("is disabled with a reason when the default peak has no finite Q centre", () => {
    const peaks = [peak(1, "substrate", [NaN, NaN])];
    expect(cutTarget(true, peaks).reason).toBe("No peak has a reciprocal-space centre");
    expect(cutTarget(true, peaks).peak).toBeNull();
  });

  it("defaults to the film peak when peaks are available", () => {
    const peaks = [peak(1, "substrate", [0.5, 4.0]), peak(2, "film", [0.4, 3.8])];
    const { peak: target, reason } = cutTarget(true, peaks);
    expect(reason).toBeNull();
    expect(target?.classification).toBe("film");
  });
});

describe("useRsm — peak-anchored radial/transverse cuts", () => {
  const CUT_RESULT: DataStruct = {
    time: [0, 1],
    values: [
      [0.5, 10],
      [0.6, 12],
    ],
    labels: ["Intensity", "N points"],
    units: ["cps", ""],
    metadata: { cut_label: "Box x=[...] sum→x @82.87 deg" },
  };

  it("radialCut builds the ruler along Q, shows it on the map, and lands a relabeled dataset", async () => {
    vi.mocked(rsmBoxCut).mockResolvedValue(CUT_RESULT);
    const before = useApp.getState().datasets.length;
    const { result } = renderHook(() => useRsm());
    const target = peak(2, "film", [0.4, 3.8]);

    await act(async () => {
      await result.current.radialCut(target);
    });

    expect(rsmBoxCut).toHaveBeenCalledTimes(1);
    const body = vi.mocked(rsmBoxCut).mock.calls[0]![0];
    expect(body.space).toBe("q");
    expect(body.angle).toBeCloseTo((Math.atan2(3.8, 0.4) * 180) / Math.PI);

    const ruler = useApp.getState().mapRuler;
    expect(ruler?.space).toBe("q");
    expect(ruler?.cx).toBeCloseTo(0.4);
    expect(ruler?.cy).toBeCloseTo(3.8);
    expect(useApp.getState().mapRoi).toBeNull(); // mutual exclusivity

    const datasets = useApp.getState().datasets;
    expect(datasets.length).toBe(before + 1);
    const landed = datasets[datasets.length - 1]!;
    expect(landed.data.metadata?.["cut_label"]).toBe("Radial cut — film peak (rank 2)");
    expect(landed.data.metadata?.["rsm_cut_kind"]).toBe("radial");
  });

  it("transverseCut rotates 90° from radialCut and labels itself distinctly", async () => {
    vi.mocked(rsmBoxCut).mockResolvedValue(CUT_RESULT);
    const { result } = renderHook(() => useRsm());
    const target = peak(1, "substrate", [0.5, 4.0]);

    await act(async () => {
      await result.current.transverseCut(target);
    });

    const body = vi.mocked(rsmBoxCut).mock.calls[0]![0];
    const radialAngle = (Math.atan2(4.0, 0.5) * 180) / Math.PI;
    expect(body.angle).toBeCloseTo(radialAngle + 90);

    const datasets = useApp.getState().datasets;
    const landed = datasets[datasets.length - 1]!;
    expect(landed.data.metadata?.["cut_label"]).toBe("Transverse cut — substrate peak (rank 1)");
  });

  it("is a no-op (with a surfaced reason) for a peak with no finite Q centre", async () => {
    const before = useApp.getState().datasets.length;
    const { result } = renderHook(() => useRsm());
    const target = peak(3, "unknown", [NaN, NaN]);

    await act(async () => {
      await result.current.radialCut(target);
    });

    expect(rsmBoxCut).not.toHaveBeenCalled();
    expect(useApp.getState().datasets.length).toBe(before);
    expect(result.current.error).toContain("reciprocal-space centre");
  });

  it("exposes the default cut target and a live disabled reason as peaks are found", async () => {
    vi.mocked(analyzeRsm).mockResolvedValue({
      peaks: [peak(1, "substrate", [0.5, 4.0]), peak(2, "film", [0.4, 3.8])],
      n_peaks_found: 2,
      intensity_unit: "cps",
      used_q_space: true,
    });
    const { result } = renderHook(() => useRsm());
    expect(result.current.cutDisabledReason).toBe("Find peaks first");
    expect(result.current.defaultCutPeak).toBeNull();

    await act(async () => {
      await result.current.analyze();
    });

    expect(result.current.cutDisabledReason).toBeNull();
    expect(result.current.defaultCutPeak?.classification).toBe("film");
  });
});
