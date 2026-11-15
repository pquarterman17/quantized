// Gap audit 6 lane K (B1): a fit curve survives reopening a project. Opening a
// .dwk (or restoring the autosave) cleared the overlays and nothing redrew
// them. A figure saved since lane C carries its own (seeded back); an older
// project's fit is redrawn from the SAVED parameters, never re-fitted, and
// fails closed with a reason (store/overlayRestore.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureFit } from "../lib/figureOverlays";
import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset, FitSpec } from "../lib/types";
import { restoreSavedFitOverlay } from "./overlayRestore";
import { useApp } from "./useApp";

const mocks = vi.hoisted(() => ({ fitBands: vi.fn(), fitModel: vi.fn() }));
vi.mock("../lib/api/fitStats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api/fitStats")>()), fitBands: mocks.fitBands,
}));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()), fitModel: mocks.fitModel,
}));

const SPEC: FitSpec = { model: "ExpDec1", xKey: null, yKey: 0, params: [0.5, 10, 1.25], nPoints: 4, nFree: 3 };
const DECAY: Dataset = {
  id: "decay", name: "decay-err.csv",
  data: { time: [0, 1, 2, 3], values: [[10.4], [5.1], [2.9], [1.6]], labels: ["signal"], units: ["V"], metadata: {} },
  fitSpec: SPEC,
};
const CURVE = [10.5, 5.2, 2.8, 1.5];

function window(dataset: Dataset, overlays?: ReturnType<typeof captureFit>): PlotWindow {
  const document = createFigureDocument({ id: "fig", name: "W", datasetId: dataset.id, view: { ...defaultPlotView(), yKeys: [0] }, overlays });
  return {
    id: "pw1", kind: "plot", title: "W", datasetId: dataset.id, geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0, winState: "normal", view: { ...defaultPlotView(), yKeys: [0] }, bg: "theme", linkGroup: null, pinned: false, document,
  };
}

beforeEach(() => {
  mocks.fitBands.mockReset();
  mocks.fitModel.mockReset();
  mocks.fitBands.mockImplementation(async ({ x }: { x: number[] }) => ({ yFit: x.map((_v, i) => CURVE[i]) }));
  useApp.setState(useApp.getInitialState(), true);
});

describe("reopening a project redraws its fit", () => {
  it("a .dwk / autosave open redraws the focused window's saved fit from its parameters (no re-fit)", async () => {
    useApp.getState().loadWorkspace({ datasets: [DECAY], plotWindows: [window(DECAY)], focusedWindowId: "pw1" });
    await vi.waitFor(() => expect(useApp.getState().fitOverlay).not.toBeNull());
    expect(useApp.getState().fitOverlay).toEqual({ datasetId: "decay", binding: { yKey: 0, xKey: null }, y: CURVE });
    expect(mocks.fitBands).toHaveBeenCalledWith(expect.objectContaining({ model: "ExpDec1", params: [0.5, 10, 1.25], covar: null, x: [0, 1, 2, 3] }));
    expect(mocks.fitModel).not.toHaveBeenCalled();
  });

  it("a figure that kept its own fit (and band) gets exactly that back, and nothing is evaluated", async () => {
    const band = [{ label: "95% CI low", y: [10, 5, 2.5, 1.2], legend: "95% confidence band" }, { label: "95% CI high", y: [11, 5.4, 3.1, 1.8], legend: "" }];
    const saved = captureFit({ datasetId: "decay", binding: { yKey: 0, xKey: null }, y: CURVE, band }, DECAY);
    useApp.getState().loadWorkspace({ datasets: [DECAY], plotWindows: [window(DECAY, saved)], focusedWindowId: "pw1" });
    await vi.waitFor(() => expect(useApp.getState().fitOverlay?.band).toEqual(band));
    expect(await restoreSavedFitOverlay()).toBe("none");
    expect(mocks.fitBands).not.toHaveBeenCalled();
  });
});

describe("fails closed, and says why", () => {
  function load(dataset: Dataset, staleFits: string[] = []): void {
    useApp.setState({ datasets: [dataset], plotWindows: [window(dataset)], focusedWindowId: "pw1", fitOverlay: null, staleFits });
  }

  it("a fit whose data changed after the save (stale): no curve, the out-of-date mark stands", async () => {
    load(DECAY, ["decay"]);
    expect(await restoreSavedFitOverlay()).toBe("refused");
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(useApp.getState().status).toMatch(/saved fit not redrawn on "decay-err.csv": its data changed after the fit/);
    expect(mocks.fitBands).not.toHaveBeenCalled();
  });

  it("a model that cannot be evaluated: no curve, and the reason", async () => {
    mocks.fitBands.mockRejectedValueOnce(new Error("unknown model 'ExpDec1'"));
    load(DECAY);
    expect(await restoreSavedFitOverlay()).toBe("refused");
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(useApp.getState().status).toMatch(/its model could not be evaluated \(unknown model 'ExpDec1'\)/);
  });

  it("a legacy fit with no recorded X/Y, or no parameters: no curve", async () => {
    load({ ...DECAY, fitSpec: { model: "ExpDec1", params: [1, 2, 3] } });
    expect(await restoreSavedFitOverlay()).toBe("refused");
    load({ ...DECAY, fitSpec: { ...SPEC, params: [] } });
    expect(await restoreSavedFitOverlay()).toBe("refused");
    expect(useApp.getState().fitOverlay).toBeNull();
    expect(mocks.fitBands).not.toHaveBeenCalled();
  });

  it("review #7: the window's own view must draw the fitted curve (hidden Y): no curve, and why", async () => {
    load(DECAY);
    useApp.setState({ hiddenChannels: [0] });
    expect(await restoreSavedFitOverlay()).toBe("refused");
    expect(useApp.getState().status).toMatch(/the fitted curve is not on this plot/);
    expect(mocks.fitBands).not.toHaveBeenCalled();
  });

  it("review #4: a range-limited fit is redrawn over its own window only", async () => {
    load({ ...DECAY, fitSpec: { ...SPEC, range: [1, 2] } });
    mocks.fitBands.mockImplementationOnce(async ({ x }: { x: number[] }) => ({ yFit: x.map(() => 7) }));
    expect(await restoreSavedFitOverlay()).toBe("drawn");
    expect(mocks.fitBands).toHaveBeenCalledWith(expect.objectContaining({ x: [1, 2] }));
    expect(useApp.getState().fitOverlay?.y).toEqual([null, 7, 7, null]);
  });

  it("never overwrites a curve drawn while the model was evaluating", async () => {
    load(DECAY);
    const other = { datasetId: "decay", binding: { yKey: 0, xKey: null }, y: [1, 2, 3, 4] };
    mocks.fitBands.mockImplementationOnce(async ({ x }: { x: number[] }) => {
      useApp.setState({ fitOverlay: other });
      return { yFit: x.map(() => 0) };
    });
    expect(await restoreSavedFitOverlay()).toBe("none");
    expect(useApp.getState().fitOverlay).toBe(other);
  });
});
