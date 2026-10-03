// Save/reopen round-trip completeness (2026-10-01 audit): a user-visible
// setting that silently resets after File ▸ Save workspace + reopen is a
// data-integrity bug. Each case writes a value through the REAL serializer
// (`serializeWorkspace`) and reads it back through the REAL parser
// (`parseWorkspace`), then compares — the only check that catches a field
// the writer emits but the reader never picks up.
import { describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { mapViewFor } from "./mapView";
import type { FigureDoc } from "./figuredoc";
import { defaultPlotView, type PlotView, type PlotWindow } from "./plotview";
import type { FrozenPlotBundle } from "./plotsnapshot";
import type { Dataset, FitSpec } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";

const VIEWPORT = { width: 5000, height: 5000 };

const ds: Dataset = {
  id: "d1",
  name: "D",
  data: {
    time: [0, 1, 2],
    values: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    labels: ["a", "b", "c"],
    units: ["", "", ""],
    metadata: {},
  },
};

const roundTrip = (state: Parameters<typeof serializeWorkspace>[0]) =>
  parseWorkspace(serializeWorkspace(state), VIEWPORT);

/** Every PlotView field set to a NON-default value. */
function everyFieldChanged(): PlotView {
  return {
    yScale: "log", xScale: "reciprocal", showGrid: false, showLegend: false, legendPos: "sw",
    legendXY: [0.2, 0.3], legendSize: [200, 100], legendFrameXY: [0.1, 0.4], legendStatic: true, legendTitle: "T",
    axisLabelOffsets: { x: [3, 4], y2: [1, 2] }, axisLabelStyles: { x: { size: 14, italic: true }, y: { bold: true } },
    plotTemplate: "aps", showAxisBox: false, xReversed: true, stackMode: true, insetMode: true, polarMode: true, statMode: true,
    statHideEmptyLevels: true, statShowGroupN: false, statShowSummary: true,
    statMarks: { box: { points: "none", jitterWidth: 0.5 } },
    statPicks: {
      mode: "violin", dist: "logistic", bins: "scott", fit: "laplace", barStack: true,
      cols: { group: [0, "a"], group2: [2, "c"], value: [1, "b"], facet: [2, "c"], color: [0, "a"] },
    },
    xLim: [1, 2], yLim: [3, 4], xStep: 0.5, yStep: 2,
    xFmt: { mode: "sci", digits: 3 }, yFmt: { mode: "eng", digits: 1 }, y2Fmt: { mode: "fixed", digits: 4 },
    plotTitle: "Ti", xAxisLabel: "X", yAxisLabel: "Y",
    xKey: 0, yKeys: [1], groupKey: 2, facetKey: 2, y2Keys: [2],
    y2Lim: [5, 6], y2Scale: "log", y2Step: 1, y2AxisLabel: "Y2",
    refLines: [{ id: "r", axis: "x", value: 1 }],
    annotations: [{ id: "a", groupId: "g", x: 1, y: 2, text: "hi", axis: 1, size: 12, anchor: "data", frame: { fill: "#fff", pad: 2 } }],
    regionShades: [{ id: "s", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#ff0000", axis: 1 }],
    shapes: [{ id: "sh", kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, anchor: "data", stroke: "#000", fill: "#111", opacity: 0.5, width: 2, dash: true }],
    seriesStyles: { 1: { color: "#123456", width: 3 } }, seriesLabels: { 1: "lab" }, errKeys: { 1: 2 },
    seriesOrder: [1], hiddenChannels: [2],
    waterfall: 0.3, waterfallDx: 0.1, panelFit: "window",
    pageSetup: { width: 5, height: 4, unit: "cm", margins: { left: 1, right: 1, top: 1, bottom: 1 }, aspectDerived: true },
  };
}

describe("PlotView: every field survives a document-backed window save/reopen", () => {
  it("the fixture really changes every field (a new PlotView field must be added here)", () => {
    const def = defaultPlotView();
    const view = everyFieldChanged();
    expect(Object.keys(view).sort()).toEqual(Object.keys(def).sort());
    for (const k of Object.keys(def) as (keyof PlotView)[]) {
      expect(JSON.stringify(view[k]), k).not.toBe(JSON.stringify(def[k]));
    }
  });

  it("round-trips the view and the window chrome", () => {
    const view = everyFieldChanged();
    const document = createFigureDocument({
      id: "f1", name: "W", datasetId: "d1", view, groupKey: view.groupKey, facetKey: view.facetKey,
    });
    const win: PlotWindow = {
      id: "w1", kind: "plot", title: "W", datasetId: "d1", geometry: { x: 1, y: 2, w: 300, h: 200 },
      z: 3, winState: "maximized", view, document, bg: "light", linkGroup: 2, pinned: true,
    };
    const back = roundTrip({ datasets: [ds], plotWindows: [win], focusedWindowId: "w1" }).plotWindows[0];
    expect(back.view).toEqual(view);
    const { view: _v, document: _d, ...chrome } = win;
    expect(back).toMatchObject(chrome);
  });
});

// The Stat Stage picks (`PlotView.statPicks`) were React state until
// 2026-10-01, so a .dwk written before then has no such key in any view.
describe("PlotView.statPicks: an older file without it opens as today", () => {
  const win = (view: PlotView): PlotWindow => ({
    id: "w1", kind: "plot", title: "W", datasetId: "d1", geometry: { x: 1, y: 2, w: 300, h: 200 },
    z: 1, winState: "normal", view, bg: "theme", linkGroup: null, pinned: false,
  });
  const savedDoc = (view: PlotView) =>
    JSON.parse(serializeWorkspace({ datasets: [ds], plotWindows: [win(view)] })) as {
      plotWindows: { view: Record<string, unknown> }[];
    };

  it("a saved view with no statPicks key reopens with the default (empty) picks", () => {
    const doc = savedDoc({ ...defaultPlotView(), statMode: true });
    expect("statPicks" in doc.plotWindows[0].view).toBe(true); // today's writer emits it
    delete doc.plotWindows[0].view.statPicks;
    const back = parseWorkspace(JSON.stringify(doc), VIEWPORT).plotWindows[0];
    expect(back.view.statPicks).toEqual({});
    expect(back.view.statMode).toBe(true);
  });

  it("junk picks drop field by field; a malformed column ref drops the whole column set", () => {
    const doc = savedDoc(defaultPlotView());
    doc.plotWindows[0].view.statPicks = {
      mode: "pie", dist: "norm", bins: 7, fit: null, barStack: "yes",
      cols: { group: [0, "a"], group2: null, value: "b", facet: null, color: null },
    };
    const back = parseWorkspace(JSON.stringify(doc), VIEWPORT).plotWindows[0];
    expect(back.view.statPicks).toEqual({ dist: "norm", fit: null });
  });
});

describe("Dataset.fitSpec: the MAIN_PLAN #30 recipe survives save/reopen", () => {
  const recipe: FitSpec = {
    model: "gauss",
    xKey: null,
    yKey: 1,
    weight: { mode: "manual", errKey: 2 },
    params: [1, 2, 3],
    exitFlag: 1,
    range: [0, 2],
    nPoints: 3,
    fittedAt: "2026-01-01T00:00:00.000Z",
    recomputedAt: "2026-01-02T00:00:00.000Z",
    preprocessing: ["smooth", "bgPoly"],
    p0: [1, 1, 1],
    lower: [0, null, 0],
    upper: [null, 5, 9],
    fixed: [false, true, false],
    uncertainty: "covariance",
  };

  it("keeps every recorded field (recompute replays p0/bounds/fixed; the Library shows recomputedAt)", () => {
    expect(roundTrip({ datasets: [{ ...ds, fitSpec: recipe }] }).datasets[0].fitSpec).toEqual(recipe);
  });

  it("a legacy {model}-only spec stays minimal — nothing is materialized", () => {
    expect(roundTrip({ datasets: [{ ...ds, fitSpec: { model: "line" } }] }).datasets[0].fitSpec)
      .toEqual({ model: "line" });
  });

  it("drops each malformed field on its own, keeping the rest", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds] })) as { datasets: Record<string, unknown>[] };
    doc.datasets[0].fitSpec = {
      model: "gauss",
      range: [0, "x"],
      nPoints: -3,
      fittedAt: 7,
      recomputedAt: "2026-01-02T00:00:00.000Z",
      preprocessing: ["smooth", 4],
      p0: [1, "2"],
      lower: [0, null],
      upper: "none",
      fixed: [true, 1],
      uncertainty: "bootstrap",
    };
    expect(parseWorkspace(JSON.stringify(doc), VIEWPORT).datasets[0].fitSpec).toEqual({
      model: "gauss",
      recomputedAt: "2026-01-02T00:00:00.000Z",
      lower: [0, null],
    });
  });
});

describe("legacy FigureDoc: a frozen dataSnapshot reopens as numbers", () => {
  const snapshot = {
    time: [0, Number.NaN, 2],
    values: [[1, -0, 3], [4, Infinity, 6], [7, 8, -Infinity]],
    labels: ["a", "b", "c"],
    units: ["", "", ""],
    metadata: {},
  };
  const doc: FigureDoc = {
    id: "fd",
    name: "F",
    datasetId: "d1",
    live: false,
    dataSnapshot: snapshot,
    config: {
      xKey: null, yKeys: null, xScale: "linear", yScale: "linear", title: "", xLabel: "", yLabel: "",
      style: "s", fmt: "pdf", dpi: 300, overrides: null, seriesStyles: null,
    },
  };

  it("decodes the save boundary's NaN/±Infinity/-0 sentinels back to numbers", () => {
    const back = roundTrip({ datasets: [ds], figureDocs: [doc] }).figureDocs[0].dataSnapshot!;
    expect(back).toEqual(snapshot);
    expect(Object.is(back.values[0][1], -0)).toBe(true);
  });

  it("reads a pre-sentinel file's null cells as NaN", () => {
    const text = serializeWorkspace({ datasets: [ds], figureDocs: [doc] });
    const legacy = JSON.parse(text) as { figureDocs: { dataSnapshot: { time: unknown[] } }[] };
    legacy.figureDocs[0].dataSnapshot.time = [0, null, 2];
    const back = parseWorkspace(JSON.stringify(legacy), VIEWPORT).figureDocs[0].dataSnapshot!;
    expect(back.time).toEqual([0, Number.NaN, 2]);
  });
});

describe("snapshot window: the waterfall block layout survives save/reopen", () => {
  it("keeps payload.blockRows and payload.decimated", () => {
    const snapshot: FrozenPlotBundle = {
      payload: {
        data: [[0, 1, 0, 1], [1, 2, 3, 4]] as unknown as FrozenPlotBundle["payload"]["data"],
        series: [{ label: "y", unit: "" }],
        xLabel: "x",
        xUnit: "",
        blockRows: 2,
        decimated: true,
      },
      styleList: null,
      labelList: null,
      errorBars: [],
      plotted: [0],
      colorByColumns: [],
      hidden: null,
    };
    const win: PlotWindow = {
      id: "s1", kind: "snapshot", title: "S", datasetId: null, geometry: { x: 0, y: 0, w: 300, h: 200 },
      z: 1, winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, snapshot,
    };
    const back = roundTrip({ datasets: [ds], plotWindows: [win] }).plotWindows.find((w) => w.id === "s1")!;
    expect(back.snapshot!.payload.blockRows).toBe(2);
    expect(back.snapshot!.payload.decimated).toBe(true);
  });
});

// P2.8 residual (b): a blank limit side is "auto for that side" (half-open,
// `lib/axisLim.ts`). It must reopen half-open — a reader that only accepted a
// finite [lo, hi] pair dropped it to full auto, losing the typed side.
describe("half-open limits survive save/reopen", () => {
  const plotWin = (view: PlotView, extra: Partial<PlotWindow> = {}): PlotWindow => ({
    id: "w1", kind: "plot", title: "W", datasetId: "d1", geometry: { x: 1, y: 2, w: 300, h: 200 },
    z: 1, winState: "normal", view, bg: "theme", linkGroup: null, pinned: false, ...extra,
  });

  it("a window view's (and its document's) X/Y limits keep their auto side", () => {
    const view: PlotView = { ...defaultPlotView(), xLim: [null, 5], yLim: [2, null] };
    const document = createFigureDocument({ id: "f1", name: "W", datasetId: "d1", view });
    const back = roundTrip({ datasets: [ds], plotWindows: [plotWin(view, { document })], focusedWindowId: "w1" })
      .plotWindows[0];
    expect(back.view.xLim).toEqual([null, 5]);
    expect(back.view.yLim).toEqual([2, null]);
    expect(back.document?.plot.view.xLim).toEqual([null, 5]);
  });

  it("a map's colour limits keep their auto side", () => {
    const mapViews = { d1: { ...mapViewFor({}, "d1"), colorLimits: [null, 50] as [number | null, number | null] } };
    expect(roundTrip({ datasets: [ds], mapViews }).mapViews?.d1?.colorLimits).toEqual([null, 50]);
  });

  it("a pair with no finite side at all reopens as full auto", () => {
    const view = { ...defaultPlotView(), xLim: [null, null] } as unknown as PlotView;
    expect(roundTrip({ datasets: [ds], plotWindows: [plotWin(view)] }).plotWindows[0].view.xLim).toBeNull();
  });
});
