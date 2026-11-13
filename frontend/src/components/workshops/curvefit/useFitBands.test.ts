// Curve Fit "Bands" hook: the band request carries the fit's residual dof
// and the merged x grid, and "Plot with band" lands a dataset + plot whose CI
// columns are a real fill (so the export carries the band).

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fitBands, type BandsResult } from "../../../lib/api/fitStats";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { rememberCurveFitOverlay } from "../../../store/curveFitOverlay";
import { bandPrefs } from "../../../store/curveFitSession";
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
  Object.assign(bandPrefs, { on: false, level: 0.95, prediction: false });
  rememberCurveFitOverlay(null);
  vi.mocked(fitBands).mockImplementation((req) => Promise.resolve(bandFor(req.x, req.level ?? 0.95)));
  useApp.setState({ datasets: [DS], activeId: "d1", fitOverlay: null });
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
    const sourceWindows = useApp.getState().plotWindows.map((w) => [w.id, w.datasetId]);
    act(() => result.current.plot());

    const added = useApp.getState().datasets.at(-1)!;
    expect(added.id).not.toBe("d1");
    expect(added.data.labels).toEqual(["M", "Linear fit", "95% CI low", "95% CI high", "95% PI low", "95% PI high"]);
    const st = useApp.getState();
    expect(st.plotWindows).toHaveLength(before + 1);
    // Its OWN window, focused and styled (the live view is the focused one's).
    const win = st.plotWindows.at(-1)!;
    expect(st.focusedWindowId).toBe(win.id);
    expect(win.datasetId).toBe(added.id);
    expect(st.seriesStyles[2]?.fill).toEqual({ vs: 3 });
    expect(st.seriesStyles[4]?.fill).toEqual({ vs: 5 });
    expect(st.seriesStyles[0]).toMatchObject({ marker: true, width: 0 });
    // Every window that showed something else still does (the import-style
    // rebind used to land on the focused SOURCE window too).
    for (const [id, ds] of sourceWindows) expect(st.plotWindows.find((w) => w.id === id)?.datasetId).toBe(ds);
  });

  // Audit #9: the band is shaded around the curve ON THE MAIN GRAPH.
  it("shades the band on the Curve Fit's own overlay, at the overlay's rows, and removes it when off", async () => {
    const overlay = { datasetId: "d1", y: [1, 3, null, 7, 9] };
    rememberCurveFitOverlay(overlay);
    useApp.setState({ fitOverlay: overlay });
    const { result } = renderHook(() => useFitBands(TARGET));
    act(() => result.current.setOn(true));
    await waitFor(() => expect(useApp.getState().fitOverlay?.band).toBeDefined());
    // The grid rows, then the overlay's non-null rows at their x.
    expect(vi.mocked(fitBands).mock.calls[0]![0].x.slice(-4)).toEqual([0, 1, 3, 4]);
    const band = useApp.getState().fitOverlay!.band!;
    expect(band).toEqual([
      { label: "95% CI low", y: [0.5, 2.5, null, 6.5, 8.5], legend: "95% confidence band" },
      { label: "95% CI high", y: [1.5, 3.5, null, 7.5, 9.5], legend: "" },
    ]);
    // Still the band plot's numbers for the panel: the grid half-width.
    expect(result.current.halfWidth).toBe(0.5);

    act(() => result.current.setPrediction(true));
    await waitFor(() => expect(useApp.getState().fitOverlay?.band?.[2]).toEqual({ label: "95% PI low", y: [0, 2, null, 6, 8], legend: "95% prediction band" }));
    act(() => result.current.setOn(false));
    await waitFor(() => expect(useApp.getState().fitOverlay?.band).toBeUndefined());
    expect(useApp.getState().fitOverlay?.y).toEqual(overlay.y);
  });

  it("never decorates a curve another tool put in the overlay slot", async () => {
    useApp.setState({ fitOverlay: { datasetId: "d1", y: [1, 3, 5, 7, 9] } }); // e.g. Quick Fit
    const { result } = renderHook(() => useFitBands(TARGET));
    act(() => result.current.setOn(true));
    await waitFor(() => expect(result.current.halfWidth).toBe(0.5));
    expect(useApp.getState().fitOverlay?.band).toBeUndefined();
  });
});
