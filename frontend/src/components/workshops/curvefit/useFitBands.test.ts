// Curve Fit "Bands" hook: the band request carries the fit's residual dof
// and the merged x grid, and "Plot with band" lands a dataset + plot whose CI
// columns are a real fill (so the export carries the band).

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitBands, type BandsResult } from "../../../lib/api/fitStats";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFitBands, type FitBandsTarget } from "./useFitBands";

vi.mock("../../../lib/api/fitStats", () => ({ fitBands: vi.fn() }));

const DS: Dataset = {
  id: "d1",
  name: "run.dat",
  data: { time: [0, 1, 2, 3, 4], values: [[1], [3], [5], [7], [9]], labels: ["M"], units: ["emu"], metadata: {} },
};

const TARGET: FitBandsTarget = {
  dataset: DS,
  model: "Linear",
  result: { params: [2, 1], covar: [[0.01, 0], [0, 0.02]], nPoints: 5, nFree: 2 },
  fitData: { x: [0, 1, 2, 3, 4], y: [1, 3, 5, 7, 9], xKey: null, yKey: 0 },
};

/** A band of half-width 0.5 on whatever grid was posted. */
function bandFor(x: number[], level: number): BandsResult {
  return {
    yFit: x.map((v) => 2 * v + 1),
    ciLo: x.map((v) => 2 * v + 0.5),
    ciHi: x.map((v) => 2 * v + 1.5),
    piLo: x.map((v) => 2 * v),
    piHi: x.map((v) => 2 * v + 2),
    level,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fitBands).mockImplementation((req) => Promise.resolve(bandFor(req.x, req.level ?? 0.95)));
  useApp.setState({ datasets: [DS], activeId: "d1" });
});

describe("useFitBands", () => {
  it("asks for nothing until the toggle is on", () => {
    renderHook(() => useFitBands(TARGET));
    expect(fitBands).not.toHaveBeenCalled();
  });

  it("sends the fit's residual dof and the data+grid rows, then reports the median half-width", async () => {
    const { result } = renderHook(() => useFitBands(TARGET));
    act(() => result.current.setOn(true));
    await waitFor(() => expect(result.current.halfWidth).toBe(0.5));
    const req = vi.mocked(fitBands).mock.calls[0]![0];
    expect(req.dof).toBe(3);
    expect(req.n_points).toBe(5);
    expect(req.level).toBe(0.95);
    expect(req.x.length).toBe(5 + 256);
    expect(req.x).toEqual([...req.x].sort((a, b) => a - b));
  });

  it("re-asks at the new level", async () => {
    const { result } = renderHook(() => useFitBands(TARGET));
    act(() => result.current.setOn(true));
    await waitFor(() => expect(result.current.halfWidth).toBe(0.5));
    act(() => result.current.setLevel(0.68));
    await waitFor(() => expect(vi.mocked(fitBands).mock.calls.at(-1)![0].level).toBe(0.68));
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("flags a fit without covariance as having no band", async () => {
    vi.mocked(fitBands).mockImplementation((req) =>
      Promise.resolve({ ...bandFor(req.x, 0.95), ciLo: req.x.map(() => null), ciHi: req.x.map(() => null) }),
    );
    const { result } = renderHook(() => useFitBands(TARGET));
    act(() => result.current.setOn(true));
    await waitFor(() => expect(result.current.empty).toBe(true));
    expect(result.current.halfWidth).toBeNull();
  });

  it("surfaces a failed request", async () => {
    vi.mocked(fitBands).mockRejectedValue(new Error("covar is singular"));
    const { result } = renderHook(() => useFitBands(TARGET));
    act(() => result.current.setOn(true));
    await waitFor(() => expect(result.current.error).toBe("covar is singular"));
    expect(result.current.busy).toBe(false);
  });

  it("plots the band as a dataset whose CI columns fill in a new window", async () => {
    const { result } = renderHook(() => useFitBands(TARGET));
    act(() => {
      result.current.setOn(true);
      result.current.setPrediction(true);
    });
    await waitFor(() => expect(result.current.halfWidth).toBe(0.5));
    const before = useApp.getState().plotWindows.length;
    act(() => result.current.plot());

    const added = useApp.getState().datasets.at(-1)!;
    expect(added.id).not.toBe("d1");
    expect(added.data.labels).toEqual(["M", "Linear fit", "95% CI low", "95% CI high", "95% PI low", "95% PI high"]);
    const wins = useApp.getState().plotWindows;
    expect(wins).toHaveLength(before + 1);
    const win = wins.at(-1)!;
    expect(win.datasetId).toBe(added.id);
    expect(win.view.seriesStyles?.[2]?.fill).toEqual({ vs: 3 });
    expect(win.view.seriesStyles?.[4]?.fill).toEqual({ vs: 5 });
  });
});
