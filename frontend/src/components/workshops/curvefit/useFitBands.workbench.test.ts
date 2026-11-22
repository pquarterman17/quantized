// Fit bands, lane WB5. The band is recomputed on every change of its inputs
// (fit, level, prediction, dataset); audit result: that reset is correct (the
// old band is dropped at once) but a SLOWER answer for older inputs could still
// land after the newer one. Forced here with two held requests.

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
  id: "d1", name: "run.dat",
  data: { time: [0, 1, 2, 3, 4], values: [[1], [3], [5], [7], [9]], labels: ["M"], units: ["emu"], metadata: {} },
};
const TARGET: FitBandsTarget = {
  dataset: DS, model: "Linear",
  result: { params: [2, 1], covar: [[0.01, 0], [0, 0.02]], nPoints: 5, nFree: 2, MSE: 0.04 },
  fitData: { x: [0, 1, 2, 3, 4], y: [1, 3, 5, 7, 9], xKey: null, yKey: 0 },
};
/** A band whose CI half-width is `half`. */
const band = (x: number[], half: number, level: number): BandsResult => ({
  yFit: x.map((v) => 2 * v + 1), ciLo: x.map((v) => 2 * v + 1 - half), ciHi: x.map((v) => 2 * v + 1 + half),
  piLo: x.map((v) => 2 * v), piHi: x.map((v) => 2 * v + 2), level,
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(bandPrefs, { on: false, level: 0.95, prediction: false });
  rememberCurveFitOverlay(null);
  useApp.setState({ datasets: [DS], activeId: "d1", fitOverlay: null });
});

describe("useFitBands stale answers", () => {
  it("characterization: a level change drops the old band at once and shows the new one", async () => {
    vi.mocked(fitBands).mockImplementation((req) => Promise.resolve(band(req.x, req.level === 0.99 ? 2 : 0.5, req.level ?? 0.95)));
    const { result } = renderHook(() => useFitBands(TARGET));
    act(() => result.current.setOn(true));
    await waitFor(() => expect(result.current.halfWidth).toBe(0.5));
    act(() => result.current.setLevel(0.99));
    expect(result.current.halfWidth).toBeNull();
    await waitFor(() => expect(result.current.halfWidth).toBe(2));
  });

  it("forced race: an older request answering after the newer one never replaces its band", async () => {
    const held: { level: number; x: number[]; resolve: (b: BandsResult) => void }[] = [];
    // The transport ignores the abort signal (a real one may answer late too).
    vi.mocked(fitBands).mockImplementation((req) => new Promise<BandsResult>((resolve) => {
      held.push({ level: req.level ?? 0.95, x: req.x, resolve });
    }));
    const { result } = renderHook(() => useFitBands(TARGET));
    act(() => result.current.setOn(true));
    await waitFor(() => expect(held).toHaveLength(1));
    act(() => result.current.setLevel(0.99));
    await waitFor(() => expect(held).toHaveLength(2));
    // Newer answers first, then the older one lands late.
    await act(async () => held[1]!.resolve(band(held[1]!.x, 2, 0.99)));
    await waitFor(() => expect(result.current.halfWidth).toBe(2));
    await act(async () => held[0]!.resolve(band(held[0]!.x, 0.5, 0.95)));
    expect(result.current.halfWidth).toBe(2);
    expect(result.current.busy).toBe(false);
  });
});
