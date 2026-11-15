// Gap audit 5 lane C: a plot window's document keeps the analysis overlays its
// canvas draws (store/windowOverlays.ts) -- folded in whenever its view is
// committed, seeded back when it takes focus, fail closed on changed rows.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { panelRenderInputs } from "../components/workshops/figurepage/panelResolve";
import { createFigureDocument, type FigureDocument } from "../lib/figureDocument";
import { captureFigureOverlays } from "../lib/figureOverlays";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset, FitOverlay } from "../lib/types";
import { sanitizeDocumentBackedPlotWindows } from "../lib/windowDocumentPersistence";
import { editableFigureHasUnsavedEdits } from "./figureUnsavedEdits";
import { loadWindowOverlays } from "./windowOverlaysLazy";
import { useApp } from "./useApp";
import { createPlotWindowDocument } from "./windowDocuments";

const A: Dataset = { id: "a", name: "a.csv", data: { time: [1, 2, 3], values: [[5], [6], [7]], labels: ["y"], units: [""], metadata: {} } };
const B: Dataset = { id: "b", name: "b.csv", data: { time: [1, 2], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } };
const FIT: FitOverlay = { datasetId: "a", binding: { yKey: 0, xKey: null }, y: [5.1, 6, 6.9] };

function doc(id: string, datasetId: string, over: Partial<FigureDocument> = {}): FigureDocument {
  return { ...createFigureDocument({ id, name: id, datasetId, view: { ...defaultPlotView(), yKeys: [0] } }), ...over };
}
function win(id: string, document: FigureDocument): PlotWindow {
  return {
    id, kind: "plot", title: id, datasetId: document.bindings.datasetId, geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0, winState: "normal", view: defaultPlotView(), bg: "theme", linkGroup: null, pinned: false, document,
  };
}
const windowDoc = (id: string) => useApp.getState().plotWindows.find((w) => w.id === id)!.document!;

beforeAll(async () => { await loadWindowOverlays(); }); // the lazy fold / seed module

beforeEach(() => {
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [A, B], activeId: "a", yKeys: [0], editableFigures: [],
    plotWindows: [win("w1", doc("fig-a", "a")), win("w2", doc("fig-b", "b"))], focusedWindowId: "w1",
    fitOverlay: FIT, baselineOverlay: null, peakOverlay: null,
  });
});

describe("fold: the focused window's document takes what its canvas draws", () => {
  it("a focus switch commits the fit into the outgoing window's document", () => {
    useApp.getState().focusWindow("w2");
    expect(windowDoc("w1").overlays?.fit?.y).toEqual([5.1, 6, 6.9]);
    expect(windowDoc("w2").overlays).toBeUndefined(); // b's window: a's fit is not its
  });

  it("Save editable figure keeps the fit; a later edit to it reads as unsaved", () => {
    const id = useApp.getState().saveFigure("w1")!;
    expect(useApp.getState().editableFigures.find((f) => f.id === id)?.overlays?.fit?.binding).toEqual({ yKey: 0, xKey: null });
    const window = () => useApp.getState().plotWindows.find((w) => w.id === "w1")!;
    expect(editableFigureHasUnsavedEdits(useApp.getState(), window())).toBe(false);
    useApp.setState({ fitOverlay: { ...FIT, y: [5, 6, 7] } }); // re-fit
    expect(editableFigureHasUnsavedEdits(useApp.getState(), window())).toBe(true);
  });

  it("removing the fit removes it from the figure on the next commit", () => {
    useApp.getState().focusWindow("w2");
    useApp.getState().focusWindow("w1"); // seeded back
    useApp.setState({ fitOverlay: null }); // Remove fit
    useApp.getState().focusWindow("w2");
    expect(windowDoc("w1").overlays).toBeUndefined();
  });

  it("the Figure Page's preview key moves with the live overlays of a focused window source", () => {
    const before = panelRenderInputs([{ source: { kind: "window", id: "w1", name: "w1" } }], useApp.getState());
    useApp.setState({ fitOverlay: { ...FIT, y: [1, 2, 3] } });
    const after = panelRenderInputs([{ source: { kind: "window", id: "w1", name: "w1" } }], useApp.getState());
    expect(after).not.toEqual(before);
  });
});

describe("seed: a window taking focus puts its saved overlays back on the canvas", () => {
  it("refocusing restores the window's own fit after another one replaced the singleton", () => {
    useApp.getState().focusWindow("w2");
    useApp.setState({ fitOverlay: { datasetId: "b", binding: { yKey: 0, xKey: null }, y: [1, 2] } });
    useApp.getState().focusWindow("w1");
    expect(useApp.getState().fitOverlay).toEqual(FIT);
  });

  it("opening a saved figure draws its fit", () => {
    const saved = doc("fig-saved", "a", { overlays: captureFigureOverlays({ fitOverlay: FIT, baselineOverlay: null, peakOverlay: null }, "a", A.data) });
    useApp.setState({ editableFigures: [saved], fitOverlay: null });
    useApp.getState().openEditableFigure("fig-saved");
    expect(useApp.getState().fitOverlay).toEqual(FIT);
  });

  it("restores the focused window's saved fit when a workspace loads", async () => {
    const saved = doc("fig-a", "a", { overlays: captureFigureOverlays({ fitOverlay: FIT, baselineOverlay: null, peakOverlay: null }, "a", A.data) });
    useApp.getState().loadWorkspace({ datasets: [A], plotWindows: [win("pw1", saved)], focusedWindowId: "pw1" });
    await vi.waitFor(() => expect(useApp.getState().fitOverlay).toEqual(FIT));
  });

  it("FAIL CLOSED: a section whose rows changed is neither drawn nor thrown away", () => {
    useApp.getState().focusWindow("w2"); // w1's document now holds the fit
    const edited: Dataset = { ...A, data: { ...A.data, values: [[5], [6], [8]] } };
    useApp.setState({ datasets: [edited, B], fitOverlay: null });
    useApp.getState().focusWindow("w1");
    expect(useApp.getState().fitOverlay).toBeNull();
    useApp.getState().focusWindow("w2");
    expect(windowDoc("w1").overlays?.fit).toBeDefined(); // kept: undo can bring its rows back
  });

  it("a dataset still loading keeps the section untouched", () => {
    useApp.getState().focusWindow("w2");
    useApp.setState({ datasets: [{ ...A, pending: { kind: "path", path: "a.opju", bookId: "b1", rows: 300, cols: 2 } }, B], fitOverlay: null });
    useApp.getState().focusWindow("w1");
    useApp.getState().focusWindow("w2");
    expect(windowDoc("w1").overlays?.fit).toBeDefined();
  });
});

describe("the section follows its dataset through document rebuilds", () => {
  const withFit = doc("fig-a", "a", { overlays: captureFigureOverlays({ fitOverlay: FIT, baselineOverlay: null, peakOverlay: null }, "a", A.data) });

  it("a rebuild on the same dataset keeps it; a rebind to another drops it", () => {
    const view = { ...defaultPlotView(), yKeys: [0] };
    expect(createPlotWindowDocument("w1", "W", "a", view, { previous: withFit }).overlays).toEqual(withFit.overlays);
    expect(createPlotWindowDocument("w1", "W", "b", view, { previous: withFit })).not.toHaveProperty("overlays");
  });

  it("the .dwk duplicate-id repair keeps it", () => {
    const raw = JSON.parse(JSON.stringify([win("w1", withFit), win("w2", withFit)]));
    const windows = sanitizeDocumentBackedPlotWindows(raw, new Set(["a"]));
    expect(windows.map((w) => (w.kind === "plot" ? w.document?.overlays?.fit?.y : null))).toEqual([FIT.y, FIT.y]);
  });
});
