// Load-failure contract for the ROI-gadget compute seam (bundle headroom
// slice 19): `store/gadgetRun.ts` loads on the first ROI compute. A body that
// will not load must leave the chip with an error and nothing busy, compute
// nothing, stay quiet when the region has already moved on, and be fetched
// again by the next compute.
//
// Order matters: vitest caches a module once it loads, so every failure case
// runs before the one that lets the load succeed.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";

// Hoisted with the mock, so the factory can read it whenever it runs.
const load = vi.hoisted(() => ({ fail: true }));
vi.mock("./gadgetRun", async (importOriginal) => {
  if (load.fail) throw new Error("chunk 404");
  return importOriginal();
});
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fitModel: vi.fn(),
  peaksIntegrate: vi.fn(),
}));

import { fitModel, peaksIntegrate } from "../lib/api";

const ds: Dataset = {
  id: "a",
  name: "a",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[0], [2], [4], [6], [8], [10]], labels: ["I"], units: [""], metadata: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
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

describe("runGadget — the compute body fails to load", () => {
  it("fit mode: reports on the fit chip and fits nothing", async () => {
    await useApp.getState().runGadget();
    const s = useApp.getState();
    // (vitest wraps a throwing mock factory's error in its own message, so
    // only the app's prefix is asserted.)
    expect(s.qfitError).toMatch(/^ROI gadget failed to load: /);
    expect(s.qfitBusy).toBe(false);
    expect(s.qfitResult).toBeNull();
    expect(s.fitOverlay).toBeNull();
    expect(fitModel).not.toHaveBeenCalled();
  });

  it("an async mode: clears busy, reports, and requests nothing", async () => {
    useApp.setState({ gadgetMode: "integrate", gadgetBusy: true });
    await useApp.getState().runGadget();
    const s = useApp.getState();
    expect(s.gadgetError).toMatch(/^ROI gadget failed to load: /);
    expect(s.gadgetBusy).toBe(false);
    expect(s.gadgetIntegrateResult).toBeNull();
    expect(peaksIntegrate).not.toHaveBeenCalled();
  });

  it("differentiate: reports and draws no derivative", async () => {
    useApp.setState({ gadgetMode: "differentiate" });
    await useApp.getState().runGadget();
    const s = useApp.getState();
    expect(s.gadgetError).toMatch(/^ROI gadget failed to load: /);
    expect(s.gadgetDerivResult).toBeNull();
    expect(s.derivOverlay).toBeNull();
  });

  it("stays quiet when the region was cleared while it loaded", async () => {
    useApp.setState({ gadgetMode: "integrate", gadgetBusy: true });
    const run = useApp.getState().runGadget();
    useApp.getState().setQfitRoi(null);
    await run;
    const s = useApp.getState();
    expect(s.gadgetError).toBeNull();
    expect(s.qfitError).toBeNull();
    expect(s.gadgetBusy).toBe(false);
  });

  it("retries the fetch on the next compute, which then lands", async () => {
    await useApp.getState().runGadget();
    expect(useApp.getState().qfitError).toMatch(/^ROI gadget failed to load: /);

    load.fail = false;
    vi.mocked(peaksIntegrate).mockResolvedValue({ peaks: [], total_area: 8, baseline: "linear" });
    useApp.setState({ gadgetMode: "integrate", gadgetBusy: true, qfitError: null });
    await useApp.getState().runGadget();
    const s = useApp.getState();
    expect(peaksIntegrate).toHaveBeenCalledTimes(1);
    expect(s.gadgetIntegrateResult).toEqual({ peaks: [], total_area: 8, baseline: "linear" });
    expect(s.gadgetError).toBeNull();
    expect(s.gadgetBusy).toBe(false);
  });
});
