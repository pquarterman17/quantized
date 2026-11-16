// Second review of lanes C/K: undo, row edits, a retained Curve Fit curve, a
// row-state change while focused, a gap row, a skipped handoff and a Peak
// Analyzer fitted background -- none may delete, lose, spread or cross-write a
// window's saved fit (store/windowOverlays.ts).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createFigureDocument, type FigureDocument } from "../lib/figureDocument";
import { captureFit, overlayRowsKey } from "../lib/figureOverlays";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { BaselineOverlay, Dataset, FitOverlay } from "../lib/types";
import { rememberCurveFitOverlay } from "./curveFitOverlay";
import { showRetainedCurve } from "./curveFitRemove";
import { retainFitted } from "./curveFitSession";
import { useApp } from "./useApp";
import { resetWindowOverlaysForTests } from "./windowOverlays";
import { loadWindowOverlays, noteMissedHandoff } from "./windowOverlaysLazy";

const A: Dataset = { id: "a", name: "a.csv", data: { time: [1, 2, 3], values: [[5], [6], [7]], labels: ["y"], units: [""], metadata: {} } };
const B: Dataset = { id: "b", name: "b.csv", data: { time: [1, 2], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } };
const FIT: FitOverlay = { datasetId: "a", binding: { yKey: 0, xKey: null }, y: [5.1, 6, 6.9] };
const FIT3: FitOverlay = { datasetId: "a", binding: { yKey: 0, xKey: null }, y: [9, 9, 9] };

function doc(id: string, datasetId: string, over: Partial<FigureDocument> = {}): FigureDocument {
  return { ...createFigureDocument({ id, name: id, datasetId, view: { ...defaultPlotView(), yKeys: [0] } }), ...over };
}
function win(id: string, document: FigureDocument): PlotWindow {
  return {
    id, kind: "plot", title: id, datasetId: document.bindings.datasetId, geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0, winState: "normal", view: { ...defaultPlotView(), yKeys: [0] }, bg: "theme", linkGroup: null, pinned: false, document,
  };
}
const app = () => useApp.getState();
const windowDoc = (id: string) => app().plotWindows.find((w) => w.id === id)!.document!;
const withFit = (id: string, ds: Dataset, fit: FitOverlay) => doc(id, ds.id, { overlays: captureFit(fit, ds) });

beforeAll(async () => { await loadWindowOverlays(); });

beforeEach(() => {
  resetWindowOverlaysForTests(); // review L6: no focus record leaks between tests
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [A, B], activeId: "a", yKeys: [0], editableFigures: [], staleFits: [], history: [], future: [],
    plotWindows: [win("w1", doc("fig-a", "a")), win("w2", doc("fig-b", "b"))],
    focusedWindowId: "w1", fitOverlay: null, baselineOverlay: null, peakOverlay: null,
  });
  useApp.setState({ fitOverlay: FIT }); // drawn in w1 (ownership recorded as it lands)
});

describe("review N1: a gap row never makes the window's own fit unreadable", () => {
  it("a fit with NaN at a blank-Y row survives focus away and back, null at the gap", () => {
    useApp.setState({ fitOverlay: { ...FIT, y: [5.1, Number.NaN, 6.9] } });
    app().focusWindow("w2");
    app().focusWindow("w1");
    expect(app().fitOverlay?.y).toEqual([5.1, null, 6.9]);
  });
});

describe("review N3: undo and row edits never delete, lose or cross-write a fit", () => {
  it("P8: an edit while the fit is shown keeps the saved section", () => {
    app().focusWindow("w2");
    app().focusWindow("w1"); // the saved fit is shown again
    app().insertRows("a", 1, 1); // clears the slot
    app().focusWindow("w2");
    expect(windowDoc("w1").overlays?.fit?.y).toEqual(FIT.y);
  });

  it("P7: Undo of the edit puts the fit back, and it survives the next focus switch", () => {
    app().focusWindow("w2");
    app().focusWindow("w1");
    app().insertRows("a", 1, 1);
    expect(app().fitOverlay).toBeNull();
    app().undo();
    expect(app().fitOverlay?.y).toEqual(FIT.y);
    app().focusWindow("w2");
    app().focusWindow("w1");
    expect(app().fitOverlay?.y).toEqual(FIT.y);
  });

  it("P1: Undo of New Graph Window brings the first window's fit back", () => {
    const id = app().createWindow("a");
    app().focusWindow(id);
    expect(app().fitOverlay).toBeNull();
    app().undo();
    expect(app().focusedWindowId).toBe("w1");
    expect(app().fitOverlay?.y).toEqual(FIT.y);
    expect(windowDoc("w1").overlays?.fit?.y).toEqual(FIT.y);
  });

  it("P4: Undo of closing the focused window brings its fit back", () => {
    app().closeWindow("w1");
    expect(app().focusedWindowId).toBe("w2");
    app().undo();
    expect(app().focusedWindowId).toBe("w1");
    expect(app().fitOverlay?.y).toEqual(FIT.y);
  });

  it("P2: a fit drawn in an undone window never overwrites the first window's own", () => {
    const id = app().createWindow("a");
    app().focusWindow(id);
    useApp.setState({ fitOverlay: FIT3 }); // a tool with no history step, in the new window
    app().undo();
    expect(app().fitOverlay?.y).toEqual(FIT.y);
    app().focusWindow("w2");
    expect(windowDoc("w1").overlays?.fit?.y).toEqual(FIT.y);
  });
});

describe("review N4: the Curve Fit panel's retained curve never spreads", () => {
  it("w1(A) -> w2(B) -> w3(A): the retained curve stays w1's", () => {
    const spec = { model: "Linear", xKey: null, yKey: 0, params: [1, 2] };
    const fitted: Dataset = { ...A, fitSpec: spec };
    useApp.setState({ datasets: [fitted, B] });
    const fit = { ...FIT };
    useApp.setState({ fitOverlay: fit }); // Curve Fit drew it in w1
    rememberCurveFitOverlay(fit);
    retainFitted({ result: {}, fitData: null, datasetId: "a", model: "Linear", xKey: null, yKey: 0 }, fitted, fit);
    useApp.setState({ plotWindows: [...app().plotWindows, win("w3", doc("fig-a3", "a"))] });
    app().focusWindow("w2");
    app().focusWindow("w3");
    showRetainedCurve("a"); // what the open panel does on a worksheet switch
    expect(app().fitOverlay).toBeNull();
    app().focusWindow("w2");
    expect(windowDoc("w3").overlays).toBeUndefined();
  });
});

describe("review N7: a row-state change while focused never re-keys the old curve", () => {
  it("excluding a row after the fit: the saved curve keeps its DRAWN rows key, so it is not seeded", () => {
    const drawnOn = overlayRowsKey(A);
    app().toggleRowExcluded("a", 2);
    app().focusWindow("w2");
    expect(windowDoc("w1").overlays?.rows).toBe(drawnOn);
    app().focusWindow("w1");
    expect(app().fitOverlay).toBeNull(); // stale against the current rows
  });
});

describe("review L5: a handoff the lazy module missed never spreads a fit", () => {
  it("the first fold after a missed handoff captures nothing", () => {
    useApp.setState({ plotWindows: [...app().plotWindows, win("w3", doc("fig-a3", "a"))] });
    noteMissedHandoff(); // focus moved to w3 while the chunk was absent
    resetWindowOverlaysForTests();
    useApp.setState({ focusedWindowId: "w3" }); // the slot still holds w1's FIT
    app().focusWindow("w2");
    expect(windowDoc("w3").overlays).toBeUndefined();
  });
});

describe("review N9: a Peak Analyzer fit's fitted background is saved and restored with it", () => {
  it("captured with its fit, seeded back on focus; an estimated-baseline preview never is", () => {
    const bg: BaselineOverlay = { datasetId: "a", binding: { yKey: 0, xKey: null }, y: [1, 1, 1], fitOf: FIT };
    useApp.setState({ baselineOverlay: bg });
    app().focusWindow("w2");
    expect(windowDoc("w1").overlays?.background?.y).toEqual([1, 1, 1]);
    expect(app().baselineOverlay).toBeNull(); // w1's fitted background does not follow focus
    app().focusWindow("w1");
    expect(app().baselineOverlay?.y).toEqual([1, 1, 1]);
    expect(app().baselineOverlay?.fitOf).toBe(app().fitOverlay);
  });

  it("an estimated baseline (no fitOf) is a preview: not saved", () => {
    useApp.setState({ baselineOverlay: { datasetId: "a", binding: { yKey: 0, xKey: null }, y: [2, 2, 2] } });
    app().focusWindow("w2");
    expect(windowDoc("w1").overlays?.background).toBeUndefined();
  });
});

describe("saved sections from a fixture still seed", () => {
  it("a window document saved with a fit seeds it on focus", () => {
    useApp.setState({ plotWindows: [win("w1", doc("fig-a", "a")), win("w2", withFit("fig-b", B, { ...FIT, datasetId: "b", y: [1, 2] }))] });
    app().focusWindow("w2");
    expect(app().fitOverlay?.datasetId).toBe("b");
  });
});
