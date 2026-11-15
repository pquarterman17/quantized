// Gap audit 5 lane C: Batch Figure Builder figures keep each dataset's saved
// fit (store/batchFigureFits.ts), and fail closed per dataset.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { overlaysMatchData } from "../lib/figureOverlays";
import { captureRecipe, type PlotRecipe } from "../lib/plotRecipe";
import { defaultPlotView } from "../lib/plotview";
import type { Dataset, FitSpec } from "../lib/types";
import { buildBatchFigureArtifacts, commitBatchFigureArtifacts, preflightBatchFigure, type BatchFigureRow } from "./batchFigureBuild";
import { batchSavedFitOverlays } from "./batchFigureFits";
import { useApp } from "./useApp";

const mocks = vi.hoisted(() => ({ fitBands: vi.fn() }));
vi.mock("../lib/api/fitStats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api/fitStats")>()), fitBands: mocks.fitBands,
}));

const FIT: FitSpec = { model: "linear", xKey: 0, yKey: 1, params: [1, 2], nPoints: 3, nFree: 2 };

function dataset(id: string, fitSpec?: FitSpec): Dataset {
  return {
    id,
    name: `${id}.xy`,
    data: { time: [0, 1, 2], values: [[10, 1], [20, 3], [30, 5]], labels: ["2theta", "Intensity"], units: ["", ""], metadata: {} },
    ...(fitSpec ? { fitSpec } : {}),
  };
}

function recipe(yKeys = [1]): PlotRecipe {
  return captureRecipe(dataset("source"), { ...defaultPlotView(), xKey: 0, yKeys }, null, { id: "r1", name: "R", appVersion: "test" });
}

const rowsFor = (datasets: Dataset[], r = recipe()): BatchFigureRow[] =>
  datasets.map((ds) => preflightBatchFigure(r, ds, { datasets }));
const ids = (...list: string[]) => new Set(list);

beforeEach(() => {
  mocks.fitBands.mockReset();
  // The model evaluated at the saved X (2theta): y = 1 + 2·x/10.
  mocks.fitBands.mockImplementation(async ({ x }: { x: number[] }) => ({ yFit: x.map((v) => 1 + (2 * v) / 10) }));
  useApp.setState(useApp.getInitialState(), true);
});

describe("batchSavedFitOverlays", () => {
  it("regenerates each dataset's saved fit on the X/Y it was fitted on, row-checked to its data", async () => {
    const datasets = [dataset("a", FIT), dataset("b")];
    const out = await batchSavedFitOverlays(rowsFor(datasets), ids("a", "b"), { datasets, staleFits: [] });
    expect([...out.keys()]).toEqual(["a"]); // b has no saved fit
    const a = out.get("a")!;
    expect(a.fit).toEqual({ binding: { yKey: 1, xKey: 0 }, y: [3, 5, 7] });
    expect(overlaysMatchData(a, datasets[0].data)).toBe(true);
    expect(mocks.fitBands).toHaveBeenCalledWith(expect.objectContaining({ model: "linear", params: [1, 2], x: [10, 20, 30], covar: null }));
  });

  it("skips (figure kept, fit left off) a stale, legacy, unplotted, excluded or failing fit", async () => {
    const legacy = dataset("legacy", { model: "linear", params: [1, 2] }); // no recorded X/Y
    const otherY = dataset("otherY", { ...FIT, yKey: 0 });
    const stale = dataset("stale", FIT);
    const notIncluded = dataset("skip", FIT);
    const datasets = [legacy, otherY, stale, notIncluded];
    const out = await batchSavedFitOverlays(rowsFor(datasets), ids("legacy", "otherY", "stale"), { datasets, staleFits: ["stale"] });
    expect(out.size).toBe(0);
    mocks.fitBands.mockRejectedValueOnce(new Error("backend down"));
    const failing = [dataset("a", FIT)];
    expect((await batchSavedFitOverlays(rowsFor(failing), ids("a"), { datasets: failing, staleFits: [] })).size).toBe(0);
    expect(mocks.fitBands).toHaveBeenCalledTimes(1); // only the failing one ever reached the model
  });

  it("a recipe on another X leaves the fit off (never drawn at a guessed X)", async () => {
    const datasets = [dataset("a", { ...FIT, xKey: null })];
    expect((await batchSavedFitOverlays(rowsFor(datasets), ids("a"), { datasets, staleFits: [] })).size).toBe(0);
  });
});

describe("buildBatchFigureArtifacts / commit with saved fits", () => {
  it("each figure carries its own dataset's fit, and the status line counts them", async () => {
    const datasets = [dataset("a", FIT), dataset("b")];
    const rows = rowsFor(datasets);
    const overlays = await batchSavedFitOverlays(rows, ids("a", "b"), { datasets, staleFits: [] });
    let n = 0;
    const artifacts = buildBatchFigureArtifacts({
      recipe: recipe(), rows, includedDatasetIds: ids("a", "b"), existingFigureNames: [], existingPageNames: [],
      namePattern: "{dataset}", createPage: false, pageName: "", columns: "auto",
      nextFigureId: () => `fig-${++n}`, nextPageId: () => "page", overlays,
    });
    expect(artifacts.figures.map((figure) => [figure.bindings.datasetId, Boolean(figure.overlays?.fit)])).toEqual([["a", true], ["b", false]]);
    useApp.setState({ datasets });
    commitBatchFigureArtifacts(artifacts);
    expect(useApp.getState().status).toBe("created 2 editable figures (1 with its saved fit)");
  });
});
