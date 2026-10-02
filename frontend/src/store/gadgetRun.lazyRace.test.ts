// Load-race contract for the ROI-gadget compute seam (bundle headroom slice
// 19): `store/gadgetRun.ts` loads on the first ROI compute of a session. A
// compute that was superseded WHILE the body loaded (the mode, ROI or model
// moved on, which bumps the request sequence and schedules its own run) must
// not start once the load lands: before the seam it started at once and the
// change made it stale, so its result could never show under the new mode.
//
// Its own file: vitest caches a module once it loads, and this needs the
// FIRST load of the session.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fitModel: vi.fn(),
  peaksIntegrate: vi.fn(),
}));

import { fitModel } from "../lib/api";

const ds: Dataset = {
  id: "a",
  name: "a",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[0], [2], [4], [6], [8], [10]], labels: ["I"], units: [""], metadata: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fitModel).mockResolvedValue({ params: { a: 2, b: 0 }, yFit: [2, 4, 6] } as never);
  useApp.setState({
    datasets: [ds],
    activeId: "a",
    yKeys: null,
    xKey: null,
    hiddenChannels: [],
    seriesOrder: null,
    qfitRoi: [1, 3],
    qfitModel: "Linear",
    qfitBusy: false,
    qfitResult: null,
    qfitError: null,
    fitOverlay: null,
    gadgetMode: "fit",
    gadgetBusy: false,
    gadgetError: null,
    gadgetIntegrateResult: null,
    gadgetDerivResult: null,
    derivOverlay: null,
  });
});

afterEach(() => {
  // Drop the debounced successor the mode switch scheduled.
  useApp.getState().setQfitRoi(null);
});

describe("runGadget — a compute superseded while its body loads", () => {
  it("a fit started in fit mode does not land after a switch to integrate", async () => {
    const run = useApp.getState().runGadget(); // first compute: the body is loading
    useApp.getState().setGadgetMode("integrate"); // superseded before it lands
    await run;
    const s = useApp.getState();
    expect(fitModel).not.toHaveBeenCalled();
    expect(s.qfitResult).toBeNull();
    expect(s.fitOverlay).toBeNull();
    expect(s.qfitBusy).toBe(false);
  });
});
