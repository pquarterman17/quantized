import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findPeaks, fitMultiPeak, fitPeak } from "../../../lib/api";
import type { DataStruct, MultiFitResult, Peak, SinglePeakFit } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { usePeaks } from "./usePeaks";

vi.mock("../../../lib/api", () => ({
  findPeaks: vi.fn(),
  fitMultiPeak: vi.fn(),
  fitPeak: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[1], [5], [2], [6], [2], [1]],
  labels: ["I"],
  units: ["cps"],
  metadata: {},
};

function pk(center: number, height: number, fwhm: number): Peak {
  return { center, height, fwhm, prominence: 1, localSNR: 10, area: null };
}

function fitted(center: number): MultiFitResult {
  return {
    peaks: [
      { center, fwhm: 0.8, height: 5, bg: 1, eta: null, area: 4, status: "fitted(global)", model: "Lorentzian" },
    ],
    bgCoeffs: [1, 0],
    R2: 0.999,
    rmse: 0.01,
    nPeaks: 1,
    model: "Lorentzian",
  };
}

function single(center: number, success: boolean): SinglePeakFit {
  return {
    success,
    reason: success ? "" : "window-too-narrow",
    center,
    fwhm: 0.8,
    height: 5,
    bg: 1,
    eta: null,
    area: 4,
    params: [5, center, 0.8, 1],
    model: "Lorentzian",
    window: [center - 1, center + 1],
  };
}

const OPTS = { model: "Lorentzian", bgDegree: 1, linkMode: "None", constrain: false };

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [{ id: "d1", name: "x.dat", data: DATA }],
    activeId: "d1",
    peakOverlay: null,
  });
  vi.mocked(findPeaks).mockResolvedValue({
    peaks: [pk(1, 5, 0.8), pk(3, 6, 0.9)],
    background: [],
  });
});

describe("usePeaks find", () => {
  it("auto-finds peaks on the active dataset and sets the overlay", async () => {
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    expect(findPeaks).toHaveBeenCalledOnce();
    expect(useApp.getState().peakOverlay?.datasetId).toBe("d1");
  });
});

describe("usePeaks exclusion honoring (#50/#53)", () => {
  it("detects on the pruned analysis view but builds a full-length overlay", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "x.dat", data: DATA, excludedRows: [1, 3] }],
      activeId: "d1",
      peakOverlay: null,
    });
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    // excluded rows 1, 3 dropped from the detection inputs
    const body = vi.mocked(findPeaks).mock.calls[0][0];
    expect(body.x).toEqual([0, 2, 4, 5]);
    expect(body.y).toEqual([1, 2, 2, 1]);
    // overlay stays full-length (6 points) so it aligns with the plot x
    expect(useApp.getState().peakOverlay?.y).toHaveLength(6);
  });

  it("fits (fitTogether) on the pruned analysis view", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "x.dat", data: DATA, excludedRows: [0, 5] }],
      activeId: "d1",
      peakOverlay: null,
    });
    vi.mocked(fitMultiPeak).mockResolvedValue(fitted(1.02));
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    await act(async () => {
      await result.current.fitTogether(OPTS);
    });
    const body = vi.mocked(fitMultiPeak).mock.calls[0][0];
    expect(body.x).toEqual([1, 2, 3, 4]); // rows 0 and 5 dropped
    expect(body.y).toEqual([5, 2, 6, 2]);
  });
});

describe("usePeaks fitTogether", () => {
  it("sends detected peaks as seeds to /fit-multi and stores the result", async () => {
    vi.mocked(fitMultiPeak).mockResolvedValue(fitted(1.02));
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    await act(async () => {
      await result.current.fitTogether(OPTS);
    });

    expect(fitMultiPeak).toHaveBeenCalledOnce();
    const body = vi.mocked(fitMultiPeak).mock.calls[0][0];
    expect(body.peaks).toEqual([
      { center: 1, fwhm: 0.8, height: 5 },
      { center: 3, fwhm: 0.9, height: 6 },
    ]);
    expect(body.model).toBe("Lorentzian");
    expect(body.bg_degree).toBe(1);
    expect(result.current.fitResult?.R2).toBe(0.999);
  });

  it("reports a fit error without throwing", async () => {
    vi.mocked(fitMultiPeak).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));
    await act(async () => {
      await result.current.fitTogether(OPTS);
    });
    expect(result.current.fitError).toBe("boom");
    expect(result.current.fitResult).toBeNull();
  });
});

describe("usePeaks fitEach", () => {
  it("fits each detected peak independently via /fit and keeps the successes", async () => {
    vi.mocked(fitPeak)
      .mockResolvedValueOnce(single(1.0, true))
      .mockResolvedValueOnce(single(3.0, false)); // second peak fails
    const { result } = renderHook(() => usePeaks());
    await waitFor(() => expect(result.current.peaks).toHaveLength(2));

    await act(async () => {
      await result.current.fitEach(OPTS);
    });

    expect(fitPeak).toHaveBeenCalledTimes(2);
    // window derives from the seed FWHM (±3·FWHM around center)
    const firstCall = vi.mocked(fitPeak).mock.calls[0][0];
    expect(firstCall.x_lo).toBeCloseTo(1 - 2.4);
    expect(firstCall.x_hi).toBeCloseTo(1 + 2.4);
    expect(result.current.fitResult?.peaks).toHaveLength(1); // only the success
    expect(result.current.fitResult?.R2).toBeNull(); // independent fits → no global R²
  });
});
