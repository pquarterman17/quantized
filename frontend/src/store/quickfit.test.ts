// Store-level quick-fit gadget tests (#33): the debounced live re-fit as the
// ROI moves/resizes, a model switch re-fitting, the explicit "Commit" writing
// a durable fitSpec, and clearing the gadget — mirrors store/recalc.test.ts's
// fake-timer + api-mock pattern (the same debounce shape as the recalc engine).

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct } from "../lib/types";
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
  });
});

describe("quick-fit gadget (#33)", () => {
  it("debounces: a burst of ROI moves triggers ONE fit request, using the latest range", async () => {
    vi.useFakeTimers();
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 0], R2: 1, yFit: [2, 4, 6] });

    useApp.getState().setQfitRoi([1, 2]); // create
    useApp.getState().setQfitRoi([1, 3]); // resize — supersedes the pending timer
    expect(fitModel).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(fitModel).toHaveBeenCalledTimes(1);
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: [1, 2, 3], y: [2, 4, 6] });
    vi.useRealTimers();
  });

  it("overlays the fit result with nulls outside the ROI (expandToFull over the full row count)", async () => {
    vi.useFakeTimers();
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 0], R2: 1, yFit: [2, 4, 6] });

    useApp.getState().setQfitRoi([1, 3]);
    await vi.advanceTimersByTimeAsync(500);

    expect(useApp.getState().fitOverlay).toEqual({
      datasetId: "a",
      y: [null, 2, 4, 6, null, null],
    });
    expect(useApp.getState().qfitResult).toEqual(
      expect.objectContaining({ params: [2, 0], R2: 1 }),
    );
    expect(useApp.getState().qfitBusy).toBe(false);
    vi.useRealTimers();
  });

  it("switching the model while an ROI is active re-fits (debounced)", async () => {
    vi.useFakeTimers();
    vi.mocked(fitModel).mockResolvedValue({ params: [1], R2: 0.9, yFit: [1, 2, 3] });
    useApp.setState({ qfitRoi: [1, 3] });

    useApp.getState().setQfitModel("Gaussian");
    await vi.advanceTimersByTimeAsync(500);

    expect(fitModel).toHaveBeenCalledTimes(1);
    expect(fitModel).toHaveBeenCalledWith(expect.objectContaining({ model: "Gaussian" }));
    vi.useRealTimers();
  });

  it("does not fetch when fewer than 2 points fall in the ROI", async () => {
    vi.useFakeTimers();
    useApp.getState().setQfitRoi([0.4, 0.6]); // no dataset x falls in this tiny range
    await vi.advanceTimersByTimeAsync(500);

    expect(fitModel).not.toHaveBeenCalled();
    expect(useApp.getState().qfitError).toMatch(/not enough points/);
    vi.useRealTimers();
  });

  it("surfaces a failed fit instead of silently clearing busy state", async () => {
    vi.useFakeTimers();
    vi.mocked(fitModel).mockRejectedValue(new Error("no convergence"));
    useApp.getState().setQfitRoi([1, 3]);
    await vi.advanceTimersByTimeAsync(500);

    expect(useApp.getState().qfitBusy).toBe(false);
    expect(useApp.getState().qfitError).toBe("no convergence");
    vi.useRealTimers();
  });

  it("commit writes the durable fitSpec and records a macro step (never auto-commits)", async () => {
    vi.useFakeTimers();
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 0], R2: 1, yFit: [2, 4, 6] });
    useApp.setState({ macroRecording: true });
    useApp.getState().setQfitRoi([1, 3]);
    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();

    // Live drag/refit alone never touches fitSpec.
    expect(useApp.getState().datasets[0].fitSpec).toBeUndefined();

    useApp.getState().commitQfit();
    expect(useApp.getState().datasets[0].fitSpec).toEqual({ model: "Linear" });
    expect(useApp.getState().macroSteps.at(-1)).toEqual(
      expect.objectContaining({ kind: "fit", params: { model: "Linear" } }),
    );
  });

  it("commit is a no-op without an active result", () => {
    useApp.getState().commitQfit();
    expect(useApp.getState().datasets[0].fitSpec).toBeUndefined();
  });

  it("clearing the roi (Escape / tool switch / ✕) drops result + busy + error", async () => {
    vi.useFakeTimers();
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 0], R2: 1, yFit: [2, 4, 6] });
    useApp.getState().setQfitRoi([1, 3]);
    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();
    expect(useApp.getState().qfitResult).not.toBeNull();

    useApp.getState().clearQfit();
    expect(useApp.getState().qfitRoi).toBeNull();
    expect(useApp.getState().qfitResult).toBeNull();
    expect(useApp.getState().qfitError).toBeNull();
    // this gadget's own overlay is cleared with it
    expect(useApp.getState().fitOverlay).toBeNull();
  });

  it("clearing before any result exists never clobbers an unrelated fit overlay", () => {
    useApp.setState({ fitOverlay: { datasetId: "a", y: [1, 2, 3, 4, 5, 6] } });
    useApp.getState().setQfitRoi([1, 3]); // armed, but no result has landed yet
    useApp.getState().clearQfit();
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "a", y: [1, 2, 3, 4, 5, 6] });
  });

  it("cancels a pending debounced fit when the roi is cleared first", async () => {
    vi.useFakeTimers();
    useApp.getState().setQfitRoi([1, 3]);
    useApp.getState().setQfitRoi(null);
    await vi.advanceTimersByTimeAsync(500);
    expect(fitModel).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
