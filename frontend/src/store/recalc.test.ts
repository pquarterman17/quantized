// Store-level recalc engine tests (#1/#4): the acceptance behaviors —
// auto mode re-runs the dependent fit on a cell edit with no user action;
// manual mode only flips staleness; the recalc's own writes never re-mark.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fitModel: vi.fn(),
  applyCorrections: vi.fn(),
}));

import { applyCorrections as applyCorrectionsApi, fitModel } from "../lib/api";

const data = (): DataStruct => ({
  time: [1, 2, 3],
  values: [[2], [4], [6]],
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
    datasets: [],
    activeId: null,
    recalcMode: "auto",
    staleDatasets: [],
    staleFits: [],
    fitOverlay: null,
    macroRecording: false,
    macroSteps: [],
  });
});

describe("recalc engine (#1)", () => {
  it("auto mode: a cell edit re-runs the dependent fit, debounced, no user action", async () => {
    vi.useFakeTimers();
    vi.mocked(fitModel).mockResolvedValue({ params: [2, 0], R2: 1, yFit: [2, 4, 99] });
    useApp.setState({
      datasets: [ds("a", { fitSpec: { model: "Linear" } })],
      activeId: "a",
      fitOverlay: { datasetId: "a", y: [2, 4, 6] },
    });

    // a burst of edits → ONE downstream pass
    useApp.getState().setCellValue("a", 2, 0, 99);
    useApp.getState().setCellValue("a", 1, 0, 4.5);
    expect(useApp.getState().staleFits).toEqual(["a"]);
    expect(fitModel).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(fitModel).toHaveBeenCalledTimes(1);
    expect(fitModel).toHaveBeenCalledWith(expect.objectContaining({ model: "Linear" }));
    expect(useApp.getState().staleFits).toEqual([]); // clean again
    expect(useApp.getState().fitOverlay?.y).toEqual([2, 4, 99]); // overlay refreshed
    vi.useRealTimers();
  });

  it("manual mode: the same edit only flips staleness (#4)", () => {
    useApp.setState({
      recalcMode: "manual",
      datasets: [ds("a", { fitSpec: { model: "Linear" } })],
    });
    useApp.getState().setCellValue("a", 0, 0, 5);
    expect(useApp.getState().staleFits).toEqual(["a"]);
    expect(fitModel).not.toHaveBeenCalled();
  });

  it("off mode: nothing is marked", () => {
    useApp.setState({
      recalcMode: "off",
      datasets: [ds("a", { fitSpec: { model: "Linear" } })],
    });
    useApp.getState().setCellValue("a", 0, 0, 5);
    expect(useApp.getState().staleFits).toEqual([]);
  });

  it("bg-dependent datasets re-derive their corrections on recalcNow", async () => {
    vi.mocked(applyCorrectionsApi).mockResolvedValue(data());
    useApp.setState({
      recalcMode: "manual",
      datasets: [
        ds("a"),
        ds("b", {
          raw: data(),
          corrections: { yOff: 1 },
          bgRef: { datasetId: "a", interp: "linear" },
        }),
      ],
    });
    useApp.getState().setCellValue("a", 0, 0, 5);
    expect(useApp.getState().staleDatasets).toEqual(["b"]);

    await useApp.getState().recalcNow();
    expect(applyCorrectionsApi).toHaveBeenCalledTimes(1); // b re-derived
    expect(useApp.getState().staleDatasets).toEqual([]);
    // and the recalc's own write did NOT re-mark b
    expect(useApp.getState().staleFits).toEqual([]);
  });

  it("a failing fit stays stale instead of vanishing", async () => {
    vi.mocked(fitModel).mockRejectedValue(new Error("no convergence"));
    useApp.setState({
      recalcMode: "manual",
      datasets: [ds("a", { fitSpec: { model: "Linear" } })],
      staleFits: ["a"],
    });
    await useApp.getState().recalcNow();
    expect(useApp.getState().staleFits).toEqual(["a"]);
    expect(useApp.getState().status).toContain("recalc fit failed");
  });
});
