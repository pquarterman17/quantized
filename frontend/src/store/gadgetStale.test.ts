// ROI gadget (#34) stale-result guards for the async region modes
// (integrate/stats/fft). Two bugs, both forced here rather than hoped for:
//  1. Moving the ROI kept the OLD region's result on the chip and left
//     `gadgetBusy` false through the 350 ms debounce, so "→ Report" / "Commit"
//     were live with the old region's numbers under the new region's caption.
//  2. No request sequence: an older response landing last overwrote a newer one.
// Promises are held open by hand and the debounce runs on fake timers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FftSpectralResult, IntegrateResponse } from "../lib/api";
import type { CalcResult, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fitModel: vi.fn(),
  peaksIntegrate: vi.fn(),
  fftSpectral: vi.fn(),
}));
vi.mock("../lib/api/statsDescriptive", () => ({
  statsDescriptive: vi.fn(),
}));

import { fftSpectral, peaksIntegrate } from "../lib/api";
import { statsDescriptive } from "../lib/api/statsDescriptive";

const data = (): DataStruct => ({
  time: [0, 1, 2, 3, 4, 5],
  values: [[0], [2], [4], [6], [8], [10]],
  labels: ["I"],
  units: [""],
  metadata: {},
});

const integ = (area: number): IntegrateResponse => ({
  peaks: [{ region: [1, 3], area, area_pct: 100, centroid: 2, height: 4, position: 2, fwhm: 1 }],
  total_area: area,
  baseline: "linear",
});

/** Every call to `fn` returns a promise the test settles by hand, in any order. */
function held<T>(fn: (...a: never[]) => Promise<T>) {
  const pending: { resolve: (r: T) => void; reject: (e: Error) => void }[] = [];
  vi.mocked(fn).mockImplementation(
    () => new Promise<T>((resolve, reject) => pending.push({ resolve, reject })),
  );
  return pending;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  useApp.setState({
    datasets: [{ id: "a", name: "a", data: data() }],
    activeId: "a",
    yKeys: null,
    xKey: null,
    hiddenChannels: [],
    seriesOrder: null,
    qfitRoi: null,
    qfitModel: "Linear",
    qfitBusy: false,
    qfitResult: null,
    qfitResultModel: null,
    qfitError: null,
    fitOverlay: null,
    gadgetMode: "integrate",
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

afterEach(() => {
  vi.useRealTimers();
});

describe("moving the ROI marks the previous region's result stale", () => {
  const fft: FftSpectralResult = {
    freq: [0, 1],
    magnitude: [1, 2],
    psd: null,
    phase: null,
    windowName: "hann",
  } as unknown as FftSpectralResult;
  const stats: CalcResult = { N: 3, mean: 4, std: 2, min: 2, max: 6 };

  it.each([
    ["integrate", () => vi.mocked(peaksIntegrate).mockResolvedValue(integ(8)), "gadgetIntegrateResult"],
    ["stats", () => vi.mocked(statsDescriptive).mockResolvedValue(stats), "gadgetStatsResult"],
    ["fft", () => vi.mocked(fftSpectral).mockResolvedValue(fft), "gadgetFftPreview"],
  ] as const)("%s: clears the result and is busy through the debounce", async (mode, arm, field) => {
    arm();
    useApp.setState({ gadgetMode: mode });
    useApp.getState().setQfitRoi([0, 4]);
    await vi.advanceTimersByTimeAsync(500);
    expect(useApp.getState()[field]).not.toBeNull();
    expect(useApp.getState().gadgetBusy).toBe(false);

    useApp.getState().setQfitRoi([1, 5]); // move — the debounce has NOT fired yet
    expect(useApp.getState()[field]).toBeNull();
    expect(useApp.getState().gadgetBusy).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(useApp.getState()[field]).not.toBeNull();
    expect(useApp.getState().gadgetBusy).toBe(false);
  });

  it("a non-async mode (differentiate) is not left busy by a move", () => {
    useApp.setState({ gadgetMode: "differentiate" });
    useApp.getState().setQfitRoi([0, 4]);
    expect(useApp.getState().gadgetBusy).toBe(false);
  });
});

describe("only the latest region request may land", () => {
  it("integrate: an older response resolving last does not overwrite the newer one", async () => {
    const pending = held(peaksIntegrate);
    useApp.getState().setQfitRoi([0, 3]);
    await vi.advanceTimersByTimeAsync(400); // request A in flight
    useApp.getState().setQfitRoi([0, 4]);
    await vi.advanceTimersByTimeAsync(400); // request B in flight
    expect(pending).toHaveLength(2);

    pending[1].resolve(integ(9)); // newer lands first
    await vi.advanceTimersByTimeAsync(0);
    pending[0].resolve(integ(8)); // older lands last
    await vi.advanceTimersByTimeAsync(0);

    expect(useApp.getState().gadgetIntegrateResult?.total_area).toBe(9);
    expect(useApp.getState().gadgetBusy).toBe(false);
  });

  it("stats: an older FAILURE landing last does not replace the newer result with an error", async () => {
    const pending = held(statsDescriptive);
    useApp.setState({ gadgetMode: "stats" });
    useApp.getState().setQfitRoi([0, 3]);
    await vi.advanceTimersByTimeAsync(400);
    useApp.getState().setQfitRoi([0, 4]);
    await vi.advanceTimersByTimeAsync(400);
    expect(pending).toHaveLength(2);

    pending[1].resolve({ N: 5, mean: 4, std: 3, min: 0, max: 8 });
    await vi.advanceTimersByTimeAsync(0);
    pending[0].reject(new Error("old region failed"));
    await vi.advanceTimersByTimeAsync(0);

    expect(useApp.getState().gadgetStatsResult).toEqual(expect.objectContaining({ N: 5 }));
    expect(useApp.getState().gadgetError).toBeNull();
  });

  it("fft: a response for a region moved away from mid-flight never lands", async () => {
    const pending = held(fftSpectral);
    useApp.setState({ gadgetMode: "fft" });
    useApp.getState().setQfitRoi([0, 4]);
    await vi.advanceTimersByTimeAsync(400); // request in flight
    useApp.getState().setQfitRoi([1, 5]); // moved; its own request not sent yet

    pending[0].resolve({ freq: [0], magnitude: [1], windowName: "hann" } as unknown as FftSpectralResult);
    await vi.advanceTimersByTimeAsync(0);

    expect(useApp.getState().gadgetFftPreview).toBeNull();
    expect(useApp.getState().gadgetBusy).toBe(true); // still waiting on the new region
  });
});
