// Store-level ROI gadget family tests (gap #34): integrate/stats/differentiate
// /fft/cursors modes, plus the mode-switch machine. Fit mode's own behavior is
// unchanged and stays covered by store/quickfit.test.ts — mirrors its
// fake-timer + api-mock pattern (the same debounce shape as the recalc engine).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fitModel: vi.fn(),
  peaksIntegrate: vi.fn(),
  statsDescriptive: vi.fn(),
  fftSpectral: vi.fn(),
}));

import { fftSpectral, peaksIntegrate, statsDescriptive } from "../lib/api";

const data = (): DataStruct => ({
  time: [0, 1, 2, 3, 4, 5],
  values: [[0], [2], [4], [6], [8], [10]],
  labels: ["I"],
  units: [""],
  metadata: {},
});

const ds = (id: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name: id,
  data: data(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  useApp.setState({
    datasets: [ds("a")],
    activeId: "a",
    yKeys: null,
    xKey: null,
    hiddenChannels: [],
    seriesOrder: null,
    macroRecording: false,
    macroSteps: [],
    qfitRoi: null,
    qfitModel: "Linear",
    qfitBusy: false,
    qfitResult: null,
    qfitError: null,
    fitOverlay: null,
    gadgetMode: "fit",
    gadgetBusy: false,
    gadgetError: null,
    gadgetIntegrateResult: null,
    gadgetStatsResult: null,
    gadgetDerivResult: null,
    derivOverlay: null,
    gadgetFftPreview: null,
    gadgetCursors: null,
    gadgetCursorResult: null,
  });
});

describe("setGadgetMode", () => {
  it("re-triggers a live ROI's compute for the newly selected mode (debounced)", async () => {
    vi.useFakeTimers();
    vi.mocked(peaksIntegrate).mockResolvedValue({
      peaks: [{ region: [1, 3], area: 8, area_pct: 100, centroid: 2, height: 4, position: 2, fwhm: 1 }],
      total_area: 8,
      baseline: "linear",
    });
    useApp.setState({ qfitRoi: [1, 3] });

    useApp.getState().setGadgetMode("integrate");
    await vi.advanceTimersByTimeAsync(500);

    expect(peaksIntegrate).toHaveBeenCalledTimes(1);
    expect(useApp.getState().gadgetIntegrateResult?.total_area).toBe(8);
    vi.useRealTimers();
  });

  it("switching into cursors mode clears any armed ROI", () => {
    useApp.setState({ qfitRoi: [1, 3] });
    useApp.getState().setGadgetMode("cursors");
    expect(useApp.getState().qfitRoi).toBeNull();
    expect(useApp.getState().gadgetMode).toBe("cursors");
  });

  it("switching OUT of cursors mode clears any placed cursors", () => {
    useApp.setState({ gadgetMode: "cursors", gadgetCursors: [1, 3] });
    useApp.getState().setGadgetMode("fit");
    expect(useApp.getState().gadgetCursors).toBeNull();
  });

  it("is a no-op when re-selecting the current mode", () => {
    useApp.setState({ qfitRoi: [1, 3] });
    useApp.getState().setGadgetMode("fit"); // already "fit"
    expect(peaksIntegrate).not.toHaveBeenCalled();
    expect(statsDescriptive).not.toHaveBeenCalled();
  });
});

describe("integrate mode (#34)", () => {
  it("debounces and calls peaksIntegrate with a single region over the first visible channel", async () => {
    vi.useFakeTimers();
    vi.mocked(peaksIntegrate).mockResolvedValue({
      peaks: [{ region: [1, 3], area: 8, area_pct: 100, centroid: 2, height: 4, position: 2, fwhm: 1 }],
      total_area: 8,
      baseline: "linear",
    });
    useApp.setState({ gadgetMode: "integrate" });

    useApp.getState().setQfitRoi([1, 2]); // create
    useApp.getState().setQfitRoi([1, 3]); // resize — supersedes the pending timer
    expect(peaksIntegrate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(peaksIntegrate).toHaveBeenCalledTimes(1);
    expect(peaksIntegrate).toHaveBeenCalledWith({
      x: [1, 2, 3],
      y: [2, 4, 6],
      regions: [[1, 3]],
      baseline: "linear",
    });
    expect(useApp.getState().gadgetIntegrateResult?.peaks[0].area).toBe(8);
    vi.useRealTimers();
  });

  it("surfaces a failed call instead of silently clearing busy state", async () => {
    vi.useFakeTimers();
    vi.mocked(peaksIntegrate).mockRejectedValue(new Error("bad region"));
    useApp.setState({ gadgetMode: "integrate" });
    useApp.getState().setQfitRoi([1, 3]);
    await vi.advanceTimersByTimeAsync(500);

    expect(useApp.getState().gadgetBusy).toBe(false);
    expect(useApp.getState().gadgetError).toBe("bad region");
    vi.useRealTimers();
  });
});

describe("stats mode (#34)", () => {
  it("debounces and calls statsDescriptive with the ROI's y values", async () => {
    vi.useFakeTimers();
    vi.mocked(statsDescriptive).mockResolvedValue({ N: 3, mean: 4, std: 2, min: 2, max: 6 });
    useApp.setState({ gadgetMode: "stats" });

    useApp.getState().setQfitRoi([1, 3]);
    await vi.advanceTimersByTimeAsync(500);

    expect(statsDescriptive).toHaveBeenCalledWith([2, 4, 6]);
    expect(useApp.getState().gadgetStatsResult).toEqual({ N: 3, mean: 4, std: 2, min: 2, max: 6 });
    vi.useRealTimers();
  });
});

describe("differentiate mode (#34)", () => {
  it("computes on the debounced ROI move (no busy state — synchronous math) and sets derivOverlay expanded to the full row count", async () => {
    vi.useFakeTimers();
    useApp.setState({ gadgetMode: "differentiate" });
    useApp.getState().setQfitRoi([1, 3]); // rows 1,2,3 -> x=[1,2,3] y=[2,4,6], slope 2 everywhere
    await vi.advanceTimersByTimeAsync(500);

    expect(useApp.getState().gadgetBusy).toBe(false);
    expect(useApp.getState().gadgetDerivResult?.dydx).toEqual([2, 2, 2]);
    expect(useApp.getState().derivOverlay).toEqual({
      datasetId: "a",
      y: [null, 2, 2, 2, null, null],
    });
    vi.useRealTimers();
  });

  it("surfaces an error for fewer than 2 points in the ROI", async () => {
    vi.useFakeTimers();
    useApp.setState({ gadgetMode: "differentiate" });
    useApp.getState().setQfitRoi([0.4, 0.6]); // no dataset x falls in this tiny range
    await vi.advanceTimersByTimeAsync(500);

    expect(useApp.getState().gadgetError).toMatch(/not enough points/);
    expect(useApp.getState().gadgetDerivResult).toBeNull();
    vi.useRealTimers();
  });
});

describe("fft mode (#34)", () => {
  it("debounces, sorts by x, and calls fftSpectral; commitGadgetFft adds a new library dataset", async () => {
    vi.useFakeTimers();
    vi.mocked(fftSpectral).mockResolvedValue({
      freq: [0, 1, 2],
      magnitude: [0, 5, 1],
      df: 1,
      nfft: 4,
      fs: 4,
      windowName: "hanning",
    });
    useApp.setState({ gadgetMode: "fft" });
    useApp.getState().setQfitRoi([0, 5]); // all 6 rows, already ascending
    await vi.advanceTimersByTimeAsync(500);

    expect(fftSpectral).toHaveBeenCalledWith({ x: [0, 1, 2, 3, 4, 5], y: [0, 2, 4, 6, 8, 10] });
    expect(useApp.getState().gadgetFftPreview?.magnitude).toEqual([0, 5, 1]);

    useApp.getState().commitGadgetFft();
    const state = useApp.getState();
    expect(state.datasets).toHaveLength(2);
    expect(state.datasets[1].data.time).toEqual([0, 1, 2]);
    expect(state.datasets[1].data.values).toEqual([[0], [5], [1]]);
    vi.useRealTimers();
  });

  it("needs at least 4 points and surfaces a clear error otherwise", async () => {
    vi.useFakeTimers();
    useApp.setState({ gadgetMode: "fft" });
    useApp.getState().setQfitRoi([1, 2]); // only 2 points
    await vi.advanceTimersByTimeAsync(500);

    expect(fftSpectral).not.toHaveBeenCalled();
    expect(useApp.getState().gadgetError).toMatch(/at least 4/);
    vi.useRealTimers();
  });

  it("commit is a no-op without a live preview", () => {
    useApp.getState().commitGadgetFft();
    expect(useApp.getState().datasets).toHaveLength(1);
  });
});

describe("cursors mode (#34)", () => {
  it("computes the Δx/Δy/slope readout synchronously against the first plotted channel", () => {
    useApp.getState().setGadgetCursors([1, 3]);
    expect(useApp.getState().gadgetCursorResult).toEqual({
      x0: 1, y0: 2, x1: 3, y1: 6, dx: 2, dy: 4, slope: 2,
    });
  });

  it("clears the readout when the cursors are cleared", () => {
    useApp.getState().setGadgetCursors([1, 3]);
    useApp.getState().setGadgetCursors(null);
    expect(useApp.getState().gadgetCursorResult).toBeNull();
  });

  it("clearQfit (dismiss) also clears cursors + their readout", () => {
    useApp.setState({ gadgetMode: "cursors" });
    useApp.getState().setGadgetCursors([1, 3]);
    useApp.getState().clearQfit();
    expect(useApp.getState().gadgetCursors).toBeNull();
    expect(useApp.getState().gadgetCursorResult).toBeNull();
  });
});

describe("setQfitRoi(null) clears every region-mode's result (#34)", () => {
  it("drops integrate/stats/differentiate/fft state alongside the fit fields", async () => {
    useApp.setState({
      gadgetBusy: true,
      gadgetError: "x",
      gadgetIntegrateResult: {
        peaks: [{ region: [1, 2], area: 1, area_pct: 1, centroid: 1, height: 1, position: 1, fwhm: 1 }],
        total_area: 1,
        baseline: "linear",
      },
      gadgetStatsResult: { N: 1 },
      gadgetDerivResult: { dydx: [1], extremumX: 1, extremumDydx: 1 },
      derivOverlay: { datasetId: "a", y: [1, 2, 3, 4, 5, 6] },
      gadgetFftPreview: { freq: [1], magnitude: [1], df: 1, nfft: 1, fs: 1, windowName: "hanning" },
    });
    useApp.getState().setQfitRoi([1, 3]);
    useApp.getState().setQfitRoi(null);

    const s = useApp.getState();
    expect(s.gadgetBusy).toBe(false);
    expect(s.gadgetError).toBeNull();
    expect(s.gadgetIntegrateResult).toBeNull();
    expect(s.gadgetStatsResult).toBeNull();
    expect(s.gadgetDerivResult).toBeNull();
    expect(s.derivOverlay).toBeNull(); // it was set by THIS gadget (gadgetDerivResult was non-null)
    expect(s.gadgetFftPreview).toBeNull();
  });
});
