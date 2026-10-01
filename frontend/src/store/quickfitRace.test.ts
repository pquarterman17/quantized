// Quick-fit gadget (#33) result/model pairing. Bug: the chip could commit one
// model's NAME with another model's PARAMETERS — a model switch left the old
// result committable, and the stale-response guard only checked that the
// dataset/ROI were still non-null, so a slow earlier response could land over
// a newer one. Now: a model or ROI change (and a failure) clears the result,
// each request carries a sequence number and only the latest one applies, and
// commit uses the model that PRODUCED the result.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { CalcResult, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fitModel: vi.fn(),
}));

import { fitModel } from "../lib/api";

const data = (): DataStruct => ({
  time: [0, 1, 2, 3, 4, 5],
  values: [[0], [2], [4], [6], [8], [10]],
  labels: ["I"],
  units: [""],
  metadata: {},
});

/** A fitModel call the test resolves by hand, in any order. */
function deferredFits() {
  const pending: { req: { model: string; x: number[] }; resolve: (r: CalcResult) => void }[] = [];
  vi.mocked(fitModel).mockImplementation(
    (req) => new Promise<CalcResult>((resolve) => pending.push({ req: req as { model: string; x: number[] }, resolve })),
  );
  return pending;
}

// The compute bodies load on the first ROI compute (bundle diet slice 19).
// Warm that load once, so the fake-timer specs below see the debounce run the
// body on the same tick it always did.
beforeAll(async () => {
  await useApp.getState().runQuickFit();
});

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
    macroRecording: false,
    macroSteps: [],
    qfitRoi: null,
    qfitModel: "Linear",
    qfitBusy: false,
    qfitResult: null,
    qfitResultModel: null,
    qfitError: null,
    fitOverlay: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("quick-fit result/model pairing", () => {
  it("a model switch clears the old model's result and its overlay at once", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 0], R2: 1, yFit: [2, 4, 6] });
    useApp.getState().setQfitRoi([1, 3]);
    await vi.advanceTimersByTimeAsync(500);
    expect(useApp.getState().qfitResult).not.toBeNull();

    useApp.getState().setQfitModel("Gaussian");
    expect(useApp.getState().qfitResult).toBeNull(); // nothing Linear left to commit as "Gaussian"
    expect(useApp.getState().fitOverlay).toBeNull();
    useApp.getState().commitQfit();
    expect(useApp.getState().datasets[0].fitSpec).toBeUndefined();
  });

  it("an ROI move clears the result that was fit to the previous range", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 0], R2: 1, yFit: [2, 4, 6] });
    useApp.getState().setQfitRoi([1, 3]);
    await vi.advanceTimersByTimeAsync(500);
    useApp.getState().setQfitRoi([2, 4]);
    expect(useApp.getState().qfitResult).toBeNull();
  });

  it("a response for a superseded model never lands, and commit names the producing model", async () => {
    const pending = deferredFits();
    useApp.getState().setQfitRoi([1, 3]);
    await vi.advanceTimersByTimeAsync(500); // Linear request in flight
    useApp.getState().setQfitModel("Gaussian");
    pending[0].resolve({ params: [2, 0], R2: 1, yFit: [2, 4, 6] }); // stale Linear lands
    await vi.advanceTimersByTimeAsync(0);
    expect(useApp.getState().qfitResult).toBeNull();

    await vi.advanceTimersByTimeAsync(500); // Gaussian request
    expect(pending[1].req.model).toBe("Gaussian");
    pending[1].resolve({ params: [5, 2, 1, 0], R2: 0.9, yFit: [1, 5, 1] });
    await vi.advanceTimersByTimeAsync(0);
    useApp.getState().commitQfit();
    expect(useApp.getState().datasets[0].fitSpec).toMatchObject({ model: "Gaussian", params: [5, 2, 1, 0] });
  });

  it("a slow earlier-ROI response cannot overwrite a newer one", async () => {
    const pending = deferredFits();
    useApp.getState().setQfitRoi([0, 2]);
    await vi.advanceTimersByTimeAsync(500); // request 1 in flight
    useApp.getState().setQfitRoi([3, 5]);
    await vi.advanceTimersByTimeAsync(500); // request 2 in flight
    pending[1].resolve({ params: [2, 0], R2: 1, yFit: [6, 8, 10] });
    await vi.advanceTimersByTimeAsync(0);
    pending[0].resolve({ params: [9, 9], R2: 0.1, yFit: [0, 2, 4] }); // the slow one lands last
    await vi.advanceTimersByTimeAsync(0);
    expect(useApp.getState().qfitResult).toMatchObject({ params: [2, 0] });
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "a", y: [null, null, null, 6, 8, 10] });
  });

  it("a failed refit clears the previous result instead of leaving it committable", async () => {
    vi.mocked(fitModel).mockResolvedValueOnce({ params: [2, 0], R2: 1, yFit: [2, 4, 6] });
    useApp.getState().setQfitRoi([1, 3]);
    await vi.advanceTimersByTimeAsync(500);
    vi.mocked(fitModel).mockRejectedValueOnce(new Error("did not converge"));
    await useApp.getState().runQuickFit();
    expect(useApp.getState().qfitError).toBe("did not converge");
    expect(useApp.getState().qfitResult).toBeNull();
    expect(useApp.getState().fitOverlay).toBeNull();
  });

  it("commit uses the model that produced the result, not the picker's current value", () => {
    useApp.setState({
      qfitRoi: [1, 3],
      qfitModel: "Linear",
      qfitResult: { params: [5, 2, 1, 0], R2: 0.9 },
      qfitResultModel: "Gaussian",
    });
    useApp.getState().commitQfit();
    expect(useApp.getState().datasets[0].fitSpec?.model).toBe("Gaussian");
  });
});
