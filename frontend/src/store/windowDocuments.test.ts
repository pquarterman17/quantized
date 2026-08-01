// Regression pins for the window-document sync bridge (F1.3, PR #104 review).
import { describe, expect, it } from "vitest";

import { createFigureDocument } from "../lib/figureDocument";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import { syncPlotWindow } from "./windowDocuments";

function plotWindow(view = defaultPlotView()): PlotWindow {
  return {
    id: "w1",
    kind: "plot",
    title: "w",
    datasetId: "d1",
    geometry: { x: 0, y: 0, w: 100, h: 100 },
    z: 0,
    winState: "normal",
    view,
    document: createFigureDocument({ id: "figure-w1", name: "w", datasetId: "d1", view }),
    bg: "theme",
    linkGroup: null,
    pinned: false,
  };
}

describe("syncPlotWindow error-binding ownership", () => {
  it("resetErrors without an explicit list derives from the view, never the stale document", () => {
    // The reimport path: the document carries a binding onto channel 5, the
    // dataset's shape changed, and the fresh view's errKeys were reset. The
    // old binding must NOT be resurrected (the 2026-07-19/21 row/column
    // index-staleness class — a resurrected channel index points at wrong or
    // nonexistent data after a shape change).
    const staleView = { ...defaultPlotView(), errKeys: { 0: 5 } };
    const win = plotWindow(staleView);
    expect(win.document?.bindings.errors).toEqual([
      { target: 0, channel: 5, axis: "y", side: "both" },
    ]);

    const freshView = { ...defaultPlotView(), errKeys: {} };
    const synced = syncPlotWindow(win, freshView, { resetErrors: true });

    expect(synced.document?.bindings.errors).toEqual([]);
    expect(synced.view.errKeys).toEqual({});
  });

  it("a plain commit sync still inherits the document's rich bindings", () => {
    const view = defaultPlotView();
    const win = plotWindow(view);
    const rich = [{ target: 1, channel: 2, axis: "x" as const, side: "+" as const }];
    win.document = createFigureDocument({
      id: "figure-w1",
      name: "w",
      datasetId: "d1",
      view,
      errors: rich,
    });

    const synced = syncPlotWindow(win, { ...view, plotTitle: "edited" });

    expect(synced.document?.bindings.errors).toEqual(rich);
    expect(synced.document?.plot.view.plotTitle).toBe("edited");
  });
});
