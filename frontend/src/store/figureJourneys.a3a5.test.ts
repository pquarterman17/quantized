// FIGURE_AUTHORING_WORKFLOW_PLAN acceptance journeys A3 / A4 / A5, automated
// against the REAL store (`useApp`), the REAL serializer and the REAL parser:
// build a figure through store actions, Save Editable Figure, write the whole
// project (`serializeWorkspace`), read it back (`parseWorkspace`), replace the
// store from it (`loadWorkspace`, exactly what File > Open does), reopen the
// figure and compare the COMPLETE state. No timers, no DOM, no backend.
//
// Only a human can judge mouse feel; this file proves nothing is lost.
import { beforeEach, describe, expect, it } from "vitest";

import { createFigureDocument, figureDocumentToPlotView } from "../lib/figureDocument";
import { defaultPlotView, type PlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";

// Every PlotView field set to a NON-default value (mirrors lib/workspaceRoundTrip.test.ts).
// (exchangeXY stays false: it is refused beside the polar / stack / inset values set here; see its own tests below.)
function everyFieldChanged(): PlotView {
  return {
    yScale: "log", xScale: "reciprocal", showGrid: false, showLegend: false, legendPos: "sw",
    legendXY: [0.2, 0.3], legendSize: [200, 100], legendFrameXY: [0.1, 0.4], legendStatic: true, legendTitle: "T",
    axisLabelOffsets: { x: [3, 4], y2: [1, 2] }, axisLabelStyles: { x: { size: 14, italic: true }, y: { bold: true } },
    plotTemplate: "aps", showAxisBox: false, xReversed: true, exchangeXY: false, stackMode: true, insetMode: true, polarMode: true, statMode: true,
    inset: { x: [1, 2], y: [3, 4], yZoom: true, at: [0.1, 0.2, 0.3, 0.4], lines: false },
    // Origin gap audit 3 #15: one of each layer kind, every field non-default.
    layers: [
      {
        id: "L1", kind: "inset", at: [0.5, 0.1, 0.3, 0.25], mark: "linesymbol",
        curves: [{ datasetId: "d1", xKey: 0, yKey: 1, label: "D: b" }],
        x: { lim: [0, 2], scale: "log", label: "H (Oe)", step: 0.5 },
        y: { lim: null, scale: "linear", label: "dM/dH", step: null },
      },
      { id: "L2", kind: "image", at: [0.05, 0.05, 0.2, 0.2], src: "data:image/png;base64,iVBORw0KGgo=", name: "tem.png" },
      { id: "L3", kind: "table", at: [0.05, 0.6, 0.3, 0.2], rows: [["T", "Hc"], ["10", "120"]], header: false },
    ],
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
    yAxes: [{ lim: [1, 9], scale: "log", step: 2, fmt: { mode: "fixed", digits: 1, minor: 2 }, label: "Y3 title", color: "#aa3300" }], yAxisOf: { 1: 3, 5: 4 },
    refLines: [{ id: "r", axis: "x", value: 1 }],
    annotations: [{ id: "a", groupId: "g", x: 1, y: 2, text: "hi", axis: 1, size: 12, anchor: "data", frame: { fill: "#fff", pad: 2 } }],
    regionShades: [{ id: "s", x1: 0, y1: 0, x2: 1, y2: 1, fill: "#ff0000", axis: 1 }],
    shapes: [{ id: "sh", kind: "rect", x1: 0, y1: 0, x2: 1, y2: 1, anchor: "data", stroke: "#000", fill: "#111", opacity: 0.5, width: 2, dash: true }],
    seriesStyles: { 1: { color: "#123456", width: 3 } }, seriesRamp: { map: "plasma", reverse: true, order: "value" }, seriesLabels: { 1: "lab" }, errKeys: { 1: 2 },
    seriesOrder: [1], hiddenChannels: [2],
    waterfall: 0.3, waterfallDx: 0.1, panelFit: "window",
    pageSetup: { width: 5, height: 4, unit: "cm", margins: { left: 1, right: 1, top: 1, bottom: 1 }, aspectDerived: true },
  };
}

const VIEWPORT = { width: 5000, height: 5000 };
const app = () => useApp.getState();

// X, three Y series, an asymmetric Y-error pair on series 1, a group column.
const ds: Dataset = {
  id: "d1",
  name: "journey.dat",
  data: {
    time: [0, 1, 2, 3],
    values: [
      [0, 10, 20, 30, 1, 2, 1],
      [1, 11, 21, 31, 1, 2, 1],
      [2, 12, 22, 32, 1, 2, 2],
      [3, 13, 23, 33, 1, 2, 2],
    ],
    labels: ["X", "A", "B", "C", "E+", "E-", "Run"],
    units: ["T", "emu", "emu", "emu", "", "", ""],
    metadata: { technique: "generic" },
  },
  errorRoles: [
    { channel: 4, target: 1, axis: "y", side: "+" },
    { channel: 5, target: 1, axis: "y", side: "-" },
  ],
};

/** The live facade as the PlotView it is: every PlotView key off the store. */
function liveView(): PlotView {
  const s = app() as unknown as Record<string, unknown>;
  return Object.fromEntries(Object.keys(defaultPlotView()).map((k) => [k, s[k]])) as unknown as PlotView;
}

const writeProject = () => serializeWorkspace({ ...app(), plotWindows: app().windowsForSave() });

/** File > Save workspace, then File > Open the written text. */
function saveAndReopenProject() {
  const loaded = parseWorkspace(writeProject(), VIEWPORT);
  expect(loaded.migrationWarnings ?? []).toEqual([]);
  app().loadWorkspace(loaded);
  return loaded;
}

beforeEach(() => {
  useApp.setState({
    datasets: [structuredClone(ds)], activeId: "d1", selectedIds: [], librarySelection: null,
    plotWindows: [], focusedWindowId: null, editableFigures: [], pages: [],
    techniqueViewMemory: {}, history: [], future: [], status: "",
  });
  app().focusWindow(app().createWindow("d1"));
});

describe("A3 lossless figure: save, close, reopen, compare the complete state", () => {
  it("the reopened document, window and live facade equal what was saved", () => {
    const winId = app().focusedWindowId!;
    app().setXKey(0);
    app().setYKeys([1, 2]);
    app().setPlotTitle("Hysteresis");
    app().setXAxisLabel("Field (T)");
    app().setYAxisLabel("Moment (emu)");
    app().setYScale("log");
    app().setXLim([0, 3]);
    app().setYLim([1, 40]);
    app().setSeriesStyle(1, { color: "#ff0000", width: 3 });
    const docId = app().saveFigure(winId)!;
    const saved = structuredClone(app().editableFigures.find((d) => d.id === docId)!);
    const savedFacade = structuredClone(liveView());

    app().closeWindow(winId);
    saveAndReopenProject();

    // Complete-document equality at the file boundary, nothing dropped or added.
    expect(app().editableFigures.find((d) => d.id === docId)).toEqual(saved);

    const reopenedId = app().openEditableFigure(docId)!;
    const win = app().plotWindows.find((w) => w.id === reopenedId)!;
    expect(win.document).toEqual(saved);
    expect(figureDocumentToPlotView(win.document!)).toEqual(savedFacade);
    // ...and the live facade of the focused, reopened window is the same view.
    expect(app().focusedWindowId).toBe(reopenedId);
    expect(liveView()).toEqual(savedFacade);
  });

  it("a second save/reopen cycle is stable (idempotent), not drifting", () => {
    const winId = app().focusedWindowId!;
    app().setYKeys([1]);
    app().setPlotTitle("T");
    const docId = app().saveFigure(winId)!;
    saveAndReopenProject();
    const once = writeProject();
    saveAndReopenProject();
    const twice = writeProject();
    const strip = (t: string) => JSON.stringify({ ...JSON.parse(t), savedAt: "" });
    expect(strip(twice)).toBe(strip(once));
    expect(app().editableFigures.map((d) => d.id)).toEqual([docId]);
  });
});

describe("A3 lossless figure: EVERY PlotView field, driven through the live facade", () => {
  it("a facade with every field non-default saves into the document and reopens to the identical facade", () => {
    const winId = app().focusedWindowId!;
    const view = everyFieldChanged();
    useApp.setState(view as unknown as Parameters<typeof useApp.setState>[0]);
    const docId = app().saveFigure(winId)!;
    const saved = structuredClone(app().editableFigures.find((d) => d.id === docId)!);
    // Nothing the facade held is missing from the saved document.
    expect(figureDocumentToPlotView(saved)).toEqual(view);
    app().closeWindow(winId);
    saveAndReopenProject();
    expect(app().editableFigures.find((d) => d.id === docId)).toEqual(saved);
    app().openEditableFigure(docId);
    expect(liveView()).toEqual(view);
  });
});

describe("A3 lossless figure: fields only the DOCUMENT owns (frozen data, breaks, encoding, publication, output)", () => {
  it("a frozen, break-carrying, encoded, publication-tuned document survives the file byte-for-field", () => {
    const doc = createFigureDocument({
      id: "fig-doc-only", name: "Doc only", datasetId: "d1",
      view: { ...defaultPlotView(), xKey: 0, yKeys: [1], plotTitle: "Frozen" },
      mark: "scatter",
      axisBreaks: { x: [[1, 2]], y: [[5, 6]], y2: [[7, 8]] },
      encoding: { color: 6, symbol: 6, label: 6, text: { color: "Run" } },
      data: { mode: "frozen", snapshot: { ...structuredClone(ds.data), time: [0, Number.NaN, 2, 3] } },
      output: { format: "svg", stylePreset: "aps", dpi: 600, transparent: true, filename: "out" },
      publication: {
        overrides: { font_size: 9, grid: true, legend: { show: false, loc: "best" }, x_lim: [null, 3] },
        seriesStyles: [{ color: "#112233", width: 2, line: "dashed", marker: true }, null],
      },
    });
    useApp.setState({ editableFigures: [doc] });
    saveAndReopenProject();
    const back = app().editableFigures[0];
    expect(back).toEqual(doc);
    expect(Number.isNaN(back.data.snapshot!.time[1])).toBe(true);
  });
});

describe("A4 complex 1-D: y2, asymmetric errors, hidden/reordered series, formats, annotations, shapes, waterfall", () => {
  function buildComplex(): string {
    const winId = app().focusedWindowId!;
    app().setXKey(0);
    app().setYKeys([1, 2, 3]);
    app().setY2Keys([3]);
    app().setY2Scale("log");
    app().setY2Lim([1, 100]);
    app().setY2AxisLabel("Right axis");
    app().setY2Fmt({ mode: "sci", digits: 2 });
    app().setXFmt({ mode: "fixed", digits: 1 });
    app().setYFmt({ mode: "eng", digits: 3 });
    app().setSeriesOrder([2, 1, 3]);
    app().toggleHidden(2);
    app().setSeriesLabel(1, "Renamed A");
    app().setSeriesStyle(3, { color: "#00aa00", width: 2 });
    app().setWaterfall(0.25);
    app().setWaterfallDx(0.05);
    app().addRefLine("x", 1.5);
    app().addAnnotation(1, 11, "note");
    useApp.setState({
      shapes: [{ id: "sh1", kind: "rect", x1: 0, y1: 10, x2: 2, y2: 20, anchor: "data", stroke: "#000000", fill: "#cccccc", opacity: 0.4, width: 2, dash: true }],
    });
    return app().saveFigure(winId)!;
  }

  it("every construct is present in the SAVED document before the round trip (no empty-vs-empty pass)", () => {
    const docId = buildComplex();
    const doc = app().editableFigures.find((d) => d.id === docId)!;
    expect(doc.bindings.y2Keys).toEqual([3]);
    expect(doc.bindings.errors).toEqual(ds.errorRoles);
    expect(doc.plot.view.seriesOrder).toEqual([2, 1, 3]);
    expect(doc.plot.view.hiddenChannels).toEqual(expect.arrayContaining([2]));
    expect(doc.plot.view.seriesLabels[1]).toBe("Renamed A");
    expect(doc.plot.view.waterfall).toBe(0.25);
    expect(doc.plot.view.annotations).toHaveLength(1);
    expect(doc.plot.view.shapes).toHaveLength(1);
    expect(doc.plot.view.refLines).toHaveLength(1);
    expect(doc.plot.view.y2Fmt).toEqual({ mode: "sci", digits: 2 });
  });

  it("survives save, close, project reopen and figure reopen with the document and facade equal", () => {
    const winId = app().focusedWindowId!;
    const docId = buildComplex();
    const saved = structuredClone(app().editableFigures.find((d) => d.id === docId)!);
    const savedFacade = structuredClone(liveView());
    app().closeWindow(winId);
    saveAndReopenProject();
    expect(app().editableFigures.find((d) => d.id === docId)).toEqual(saved);
    app().openEditableFigure(docId);
    expect(app().plotWindows.find((w) => w.document?.id === docId)!.document).toEqual(saved);
    expect(liveView()).toEqual(savedFacade);
    // Asymmetric errors ride bindings, not the legacy symmetric projection.
    expect(app().editableFigures[0].bindings.errors).toEqual(ds.errorRoles);
  });

  it("saving the reopened figure again keeps the asymmetric bindings (rebuild must not re-derive them)", () => {
    const winId = app().focusedWindowId!;
    const docId = buildComplex();
    app().closeWindow(winId);
    saveAndReopenProject();
    const reopened = app().openEditableFigure(docId)!;
    app().setPlotTitle("edited after reopen");
    app().saveFigure(reopened);
    const doc = app().editableFigures.find((d) => d.id === docId)!;
    expect(doc.bindings.errors).toEqual(ds.errorRoles);
    expect(doc.plot.view.plotTitle).toBe("edited after reopen");
    expect(doc.plot.view.seriesOrder).toEqual([2, 1, 3]);
    expect(doc.plot.view.hiddenChannels).toEqual(expect.arrayContaining([2]));
  });
});

describe("A5 group/facet: bindings survive save/reopen", () => {
  it("groupKey and facetKey ride the document and project back into the live facade", () => {
    const winId = app().focusedWindowId!;
    app().setXKey(0);
    app().setYKeys([1]);
    app().setGroupKey(6);
    useApp.setState({ facetKey: 6 });
    const docId = app().saveFigure(winId)!;
    const saved = structuredClone(app().editableFigures.find((d) => d.id === docId)!);
    expect(saved.bindings.groupKey).toBe(6);
    expect(saved.bindings.facetKey).toBe(6);
    app().closeWindow(winId);
    saveAndReopenProject();
    expect(app().editableFigures.find((d) => d.id === docId)).toEqual(saved);
    app().openEditableFigure(docId);
    expect(app().groupKey).toBe(6);
    expect(app().facetKey).toBe(6);
    const doc = app().plotWindows.find((w) => w.document?.id === docId)!.document!;
    expect(doc.bindings.groupKey).toBe(6);
    expect(doc.bindings.facetKey).toBe(6);
    // A group/facet binding never leaks into the visual state half.
    expect("groupKey" in doc.plot.view).toBe(false);
    expect("facetKey" in doc.plot.view).toBe(false);
  });

  it("clearing group then saving drops the binding (no stale group after reopen)", () => {
    const winId = app().focusedWindowId!;
    app().setGroupKey(6);
    app().saveFigure(winId);
    app().setGroupKey(null);
    const docId = app().saveFigure(winId)!;
    app().closeWindow(winId);
    saveAndReopenProject();
    expect(app().editableFigures.find((d) => d.id === docId)!.bindings.groupKey).toBeNull();
  });
});
