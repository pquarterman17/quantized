// Lanes C/K review 3 R1: the commonest way to fit is "pick the column, then
// fit" -- the plotted Y (or X) changes while the window has focus, and only the
// store's live view knows it (the window's document is synced at commit). An
// undo snapshot that checked the fit's placement against the document's STALE
// view found the fit "not on this plot" and dropped it, so undoing a window
// step lost the fit from the canvas and from the figure.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset, FitOverlay } from "../lib/types";
import { useApp } from "./useApp";
import { resetWindowOverlaysForTests } from "./windowOverlays";
import { loadWindowOverlays } from "./windowOverlaysLazy";

// Three channels: an X column, then two Y columns.
const C: Dataset = {
  id: "c", name: "c.csv",
  data: { time: [1, 2, 3], values: [[30, 5, 1], [20, 6, 2], [10, 7, 3]], labels: ["t2", "y", "z"], units: ["", "", ""], metadata: {} },
};
const B: Dataset = { id: "b", name: "b.csv", data: { time: [1, 2], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } };
const FITZ: FitOverlay = { datasetId: "c", binding: { yKey: 2, xKey: null }, y: [1.1, 2, 2.9] };
const FITZX: FitOverlay = { datasetId: "c", binding: { yKey: 2, xKey: 0 }, y: [1.2, 2, 2.8] };

function win(id: string, datasetId: string): PlotWindow {
  const view = { ...defaultPlotView(), yKeys: [1] }; // the window was focused plotting "y"
  return {
    id, kind: "plot", title: id, datasetId, geometry: { x: 0, y: 0, w: 400, h: 300 }, z: 0, winState: "normal",
    view, bg: "theme", linkGroup: null, pinned: false, document: createFigureDocument({ id: `fig-${id}`, name: id, datasetId, view }),
  };
}
const app = () => useApp.getState();
const doc = (id: string) => app().plotWindows.find((w) => w.id === id)!.document!;

beforeAll(async () => { await loadWindowOverlays(); });

beforeEach(() => {
  resetWindowOverlaysForTests();
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [C, B], activeId: "c", xKey: null, yKeys: [1], editableFigures: [], staleFits: [], history: [], future: [],
    plotWindows: [win("w1", "c"), win("w2", "b")], focusedWindowId: "w1",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null,
  });
  app().focusWindow("w2");
  app().focusWindow("w1"); // a focus this module saw
});

/** Pick another column to plot (the live view only), then fit it. */
function plotAndFit(view: { xKey: number | null; yKeys: number[] }, fit: FitOverlay): void {
  useApp.setState(view);
  useApp.setState({ fitOverlay: fit });
}

describe("review 3 R1: undo of a window step keeps a fit on a column plotted since focus", () => {
  it("New Graph Window, then Undo", () => {
    plotAndFit({ xKey: null, yKeys: [2] }, FITZ);
    const id = app().createWindow("c");
    app().focusWindow(id);
    expect(doc("w1").overlays?.fit?.y).toEqual(FITZ.y);
    app().undo();
    expect(app().focusedWindowId).toBe("w1");
    expect(app().yKeys).toEqual([2]);
    expect(app().fitOverlay?.y).toEqual(FITZ.y);
    expect(doc("w1").overlays?.fit?.y).toEqual(FITZ.y);
  });

  it("Close the focused window, then Undo", () => {
    plotAndFit({ xKey: null, yKeys: [2] }, FITZ);
    app().closeWindow("w1");
    expect(app().focusedWindowId).toBe("w2");
    app().undo();
    expect(app().focusedWindowId).toBe("w1");
    expect(app().fitOverlay?.y).toEqual(FITZ.y);
    expect(doc("w1").overlays?.fit?.y).toEqual(FITZ.y);
  });

  it("an X change too: New Graph Window, then Undo", () => {
    plotAndFit({ xKey: 0, yKeys: [2] }, FITZX);
    const id = app().createWindow("c");
    app().focusWindow(id);
    app().undo();
    expect(app().focusedWindowId).toBe("w1");
    expect(app().fitOverlay?.y).toEqual(FITZX.y);
    expect(doc("w1").overlays?.fit?.binding).toEqual({ yKey: 2, xKey: 0 });
  });
});

describe("review 3 L3: a save or a preview never moves the focus record", () => {
  it("windowsForSave and liveWindowDocument read the fit without recording it as shown", async () => {
    const { shownForTests } = await import("./windowOverlays");
    const { liveWindowDocument } = await import("./liveWindowDocument");
    plotAndFit({ xKey: null, yKeys: [2] }, FITZ);
    expect(shownForTests()).toBeNull(); // nothing was shown from w1's (empty) document
    expect(app().windowsForSave().find((w) => w.id === "w1")!.document!.overlays?.fit?.y).toEqual(FITZ.y);
    expect(liveWindowDocument(app(), app().plotWindows[0]!)!.overlays?.fit?.y).toEqual(FITZ.y);
    expect(shownForTests()).toBeNull();
  });
});

describe("review 3 L4: an undo step does not copy the shown curve again", () => {
  it("consecutive snapshots share one immutable section for the same curve", () => {
    plotAndFit({ xKey: null, yKeys: [2] }, FITZ);
    app().recordHistory("edit 1");
    app().recordHistory("edit 2");
    const sections = app().history.slice(-2).map((h) => h.snapshot.plotWindows.find((w) => w.id === "w1")!.document!.overlays);
    expect(sections[0]?.fit?.y).toEqual(FITZ.y);
    expect(sections[1]).toBe(sections[0]);
  });
});
