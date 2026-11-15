// The ROI gadget on a T1,R1,T2,R2 sheet with the primary curve (R1) HIDDEN:
// it computes on the first VISIBLE curve, R2, against R2's OWN X (T2,
// non-monotonic 40, 10, 30, 20), clips the ROI in T2's units, and binds its
// overlays to (R2, T2) -- so showing R1 again later cannot move the fit onto T1.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { overlayLayout, placeOverlay } from "../lib/overlayPlacement";
import { perSeriesXData } from "../lib/perSeriesX";
import { t1r1t2r2 } from "../test/ownXFixture";
import { useApp } from "./useApp";

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  fitModel: vi.fn(),
}));

import { fitModel } from "../lib/api";

beforeAll(async () => {
  await useApp.getState().runQuickFit(); // warm the lazily loaded compute bodies
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({
    datasets: [t1r1t2r2()], activeId: "own", yKeys: null, xKey: null, seriesOrder: null,
    hiddenChannels: [0, 1], // R1 (the primary) and the T2 column hidden: R2 is the first visible
    qfitRoi: [15, 45], qfitModel: "Linear", qfitResult: null, qfitError: null, qfitBusy: false,
    fitOverlay: null, derivOverlay: null, gadgetDerivResult: null, gadgetError: null,
  });
});

/** Where the canvas draws `o` once R1 is shown again (blocks T1, T2). */
const placedWithR1Shown = <T extends { datasetId: string; y: (number | null)[] }>(o: T) => {
  const ds = useApp.getState().datasets[0]!;
  return placeOverlay(o, overlayLayout(ds, null, perSeriesXData(ds, null, [0, 2])?.blocks, [0, 2]));
};

describe("ROI gadget on a hidden primary", () => {
  it("quick-fits R2 against T2 inside the ROI and binds the curve to (R2, T2)", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [10, 0], yFit: [400, 300, 200] });
    await useApp.getState().runQuickFit();
    // Rows 0, 2, 3 have T2 in [15, 45]; row 1 (T2 = 10) is outside.
    expect(fitModel).toHaveBeenCalledWith({ model: "Linear", x: [40, 30, 20], y: [100, 300, 400] });
    const o = useApp.getState().fitOverlay!;
    expect(o).toEqual({ datasetId: "own", binding: { yKey: 2, xKey: 1 }, y: [400, null, 300, 200] });
    // R1 shown again: still on T2's rows (block 2), never on T1's.
    expect(placedWithR1Shown(o)?.y).toEqual([null, null, null, null, 400, null, 300, 200]);
  });

  it("commits the curve it FITTED even after R1 is shown again", async () => {
    vi.mocked(fitModel).mockResolvedValue({ params: [10, 0], yFit: [400, 300, 200] });
    await useApp.getState().runQuickFit();
    useApp.setState({ hiddenChannels: [1] }); // R1 is now the first visible curve
    useApp.getState().commitQfit();
    expect(useApp.getState().datasets[0]!.fitSpec).toMatchObject({ model: "Linear", xKey: 1, yKey: 2, params: [10, 0] });
  });

  it("differentiates R2 against T2 and binds dy/dx to (R2, T2)", async () => {
    await useApp.getState().runGadgetDifferentiate();
    const o = useApp.getState().derivOverlay!;
    expect(o.binding).toEqual({ yKey: 2, xKey: 1 });
    expect(o.y[1]).toBeNull(); // T2 = 10 is outside the ROI
    expect(placedWithR1Shown(o)?.y.slice(0, 4)).toEqual([null, null, null, null]);
  });
});
