// Gap audit 5 lane C (+ review of lanes C/K): a plot window's document keeps
// the fit ITS canvas draws (store/windowOverlays.ts). The fit slot is
// window-scoped: folded in when the view is committed, handed to the window
// that takes focus, removed only when this window showed it and it is gone.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { panelRenderInputs } from "../components/workshops/figurepage/panelResolve";
import { createFigureDocument, type FigureDocument } from "../lib/figureDocument";
import { captureFit } from "../lib/figureOverlays";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset, FitOverlay } from "../lib/types";
import { sanitizeDocumentBackedPlotWindows } from "../lib/windowDocumentPersistence";
import { editableFigureHasUnsavedEdits } from "./figureUnsavedEdits";
import { useApp } from "./useApp";
import { createPlotWindowDocument } from "./windowDocuments";
import { resetWindowOverlaysForTests } from "./windowOverlays";
import { loadWindowOverlays } from "./windowOverlaysLazy";

const A: Dataset = { id: "a", name: "a.csv", data: { time: [1, 2, 3], values: [[5], [6], [7]], labels: ["y"], units: [""], metadata: {} } };
const B: Dataset = { id: "b", name: "b.csv", data: { time: [1, 2], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} } };
const FIT: FitOverlay = { datasetId: "a", binding: { yKey: 0, xKey: null }, y: [5.1, 6, 6.9] };
const FIT_B: FitOverlay = { datasetId: "b", binding: { yKey: 0, xKey: null }, y: [1.1, 1.9] };
const PENDING = { kind: "path" as const, path: "a.opju", bookId: "b1", rows: 3, cols: 1 };

function doc(id: string, datasetId: string, over: Partial<FigureDocument> = {}): FigureDocument {
  return { ...createFigureDocument({ id, name: id, datasetId, view: { ...defaultPlotView(), yKeys: [0] } }), ...over };
}
function win(id: string, document: FigureDocument): PlotWindow {
  return {
    id, kind: "plot", title: id, datasetId: document.bindings.datasetId, geometry: { x: 0, y: 0, w: 400, h: 300 },
    z: 0, winState: "normal", view: { ...defaultPlotView(), yKeys: [0] }, bg: "theme", linkGroup: null, pinned: false, document,
  };
}
const withFit = (id: string, ds: Dataset, fit: FitOverlay) => doc(id, ds.id, { overlays: captureFit(fit, ds) });
const windowDoc = (id: string) => useApp.getState().plotWindows.find((w) => w.id === id)!.document!;
const focus = (id: string) => useApp.getState().focusWindow(id);

beforeAll(async () => { await loadWindowOverlays(); }); // the lazy fold / handoff module

beforeEach(() => {
  resetWindowOverlaysForTests(); // review L6
  useApp.setState(useApp.getInitialState(), true);
  useApp.setState({
    datasets: [A, B], activeId: "a", yKeys: [0], editableFigures: [], staleFits: [],
    plotWindows: [win("w1", doc("fig-a", "a")), win("w2", doc("fig-b", "b")), win("w3", doc("fig-a3", "a"))],
    focusedWindowId: "w1", fitOverlay: FIT, baselineOverlay: null, peakOverlay: null,
  });
});

describe("fold: the focused window's document takes the fit its canvas draws", () => {
  it("a focus switch commits the fit into the outgoing window, and refocusing brings it back", () => {
    focus("w2");
    expect(windowDoc("w1").overlays?.fit?.y).toEqual([5.1, 6, 6.9]);
    expect(useApp.getState().fitOverlay).toBeNull(); // w2 has no fit of its own
    focus("w1");
    expect(useApp.getState().fitOverlay).toEqual(FIT);
  });

  it("review #6: never spreads to another window on the same dataset", () => {
    focus("w3"); // also on dataset a
    expect(useApp.getState().fitOverlay).toBeNull(); // not w1's fit on w3's canvas
    focus("w2");
    expect(windowDoc("w3").overlays).toBeUndefined();
    expect(windowDoc("w1").overlays?.fit).toBeDefined();
  });

  it("Save editable figure keeps the fit; a re-fit then reads as an unsaved edit", () => {
    const id = useApp.getState().saveFigure("w1")!;
    expect(useApp.getState().editableFigures.find((f) => f.id === id)?.overlays?.fit?.binding).toEqual({ yKey: 0, xKey: null });
    const window = () => useApp.getState().plotWindows.find((w) => w.id === "w1")!;
    expect(editableFigureHasUnsavedEdits(useApp.getState(), window())).toBe(false);
    useApp.setState({ fitOverlay: { ...FIT, y: [5, 6, 7] } });
    expect(editableFigureHasUnsavedEdits(useApp.getState(), window())).toBe(true);
  });

  it("removing a fit this window showed removes it from the figure on the next commit", () => {
    focus("w2");
    focus("w1"); // shown again
    useApp.setState({ fitOverlay: null }); // Remove fit
    focus("w2");
    expect(windowDoc("w1").overlays).toBeUndefined();
  });

  it("review #2: the slot holding ANOTHER dataset's fit never deletes this window's own", () => {
    useApp.setState({ plotWindows: [win("w1", doc("fig-a", "a")), win("w2", withFit("fig-b", B, FIT_B))] });
    focus("w2");
    expect(useApp.getState().fitOverlay).toEqual(FIT_B);
    useApp.setState({ fitOverlay: FIT }); // a tool drew dataset a's fit meanwhile
    focus("w1");
    expect(windowDoc("w2").overlays?.fit?.y).toEqual(FIT_B.y);
  });

  it("review #7: a fit not placed on the window's view (its curve hidden) is not captured", () => {
    useApp.setState({ hiddenChannels: [0] });
    focus("w2");
    expect(windowDoc("w1").overlays).toBeUndefined();
  });

  it("review L2: a figure panel's preview key moves with staleFits and the dataset's row state", () => {
    useApp.setState({ editableFigures: [withFit("fig-saved", A, FIT)] });
    const key = () => panelRenderInputs([{ source: { kind: "figure", id: "fig-saved", name: "f" } }], useApp.getState());
    const before = key();
    useApp.setState({ staleFits: ["a"] });
    const stale = key();
    expect(stale).not.toEqual(before);
    useApp.setState({ staleFits: [], datasets: [{ ...A, excludedRows: [1] }, B] });
    expect(key()).not.toEqual(before);
  });

  it("the Figure Page's preview key moves with the live fit of a focused window source", () => {
    const before = panelRenderInputs([{ source: { kind: "window", id: "w1", name: "w1" } }], useApp.getState());
    useApp.setState({ fitOverlay: { ...FIT, y: [1, 2, 3] } });
    const after = panelRenderInputs([{ source: { kind: "window", id: "w1", name: "w1" } }], useApp.getState());
    expect(after).not.toEqual(before);
  });
});

describe("handoff: a window taking focus shows its own saved fit", () => {
  it("opening a saved figure draws its fit", () => {
    useApp.setState({ editableFigures: [withFit("fig-saved", A, FIT)], fitOverlay: null });
    useApp.getState().openEditableFigure("fig-saved");
    expect(useApp.getState().fitOverlay).toEqual(FIT);
  });

  it("restores the focused window's saved fit when a workspace loads", async () => {
    useApp.getState().loadWorkspace({ datasets: [A], plotWindows: [win("pw1", withFit("fig-a", A, FIT))], focusedWindowId: "pw1" });
    await vi.waitFor(() => expect(useApp.getState().fitOverlay).toEqual(FIT));
  });

  it("FAIL CLOSED: a section whose rows changed is neither drawn nor thrown away", () => {
    focus("w2"); // w1's document now holds the fit
    useApp.setState({ datasets: [{ ...A, excludedRows: [2] }, B] }); // row state changed
    focus("w1");
    expect(useApp.getState().fitOverlay).toBeNull();
    focus("w2");
    expect(windowDoc("w1").overlays?.fit).toBeDefined(); // kept: undo can bring its rows back
  });

  it("a fit marked stale is not drawn (staleFits), and kept", () => {
    focus("w2");
    useApp.setState({ staleFits: ["a"] });
    focus("w1");
    expect(useApp.getState().fitOverlay).toBeNull();
    focus("w2");
    expect(windowDoc("w1").overlays?.fit).toBeDefined();
  });
});

describe("review #1: a lazy book never loses its saved fit", () => {
  beforeEach(() => {
    focus("w2"); // w1's document holds the fit
    useApp.setState({ datasets: [{ ...A, pending: PENDING }, B], fitOverlay: null });
  });

  it("pending -> resolved -> focus away keeps the section, and the fit is redrawn on load", () => {
    focus("w1");
    expect(useApp.getState().fitOverlay).toBeNull(); // preview rows: cannot be checked yet
    useApp.setState({ datasets: [A, B] }); // the book finished loading, same rows
    expect(useApp.getState().fitOverlay).toEqual(FIT); // RESEED
    focus("w2");
    expect(windowDoc("w1").overlays?.fit?.y).toEqual(FIT.y);
  });

  it("focusing away while still pending keeps it too", () => {
    focus("w1");
    focus("w2");
    expect(windowDoc("w1").overlays?.fit).toBeDefined();
  });
});

describe("load sweep and document rebuilds", () => {
  it("review #12: an unreadable section is dropped once at load, with a notice", async () => {
    const broken = doc("fig-a", "a", { overlays: { rows: "x", fit: { binding: {}, y: "no" } } as never });
    useApp.getState().loadWorkspace({ datasets: [A], plotWindows: [win("pw1", broken)], focusedWindowId: "pw1" });
    await vi.waitFor(() => expect(useApp.getState().status).toMatch(/dropped 1 unreadable saved fit curve/));
    expect(windowDoc("pw1").overlays).toBeUndefined();
  });

  it("a rebuild on the same dataset keeps the section; a rebind to another drops it", () => {
    const saved = withFit("fig-a", A, FIT);
    const view = { ...defaultPlotView(), yKeys: [0] };
    expect(createPlotWindowDocument("w1", "W", "a", view, { previous: saved }).overlays).toEqual(saved.overlays);
    expect(createPlotWindowDocument("w1", "W", "b", view, { previous: saved })).not.toHaveProperty("overlays");
  });

  it("the .dwk duplicate-id repair keeps it", () => {
    const saved = withFit("fig-a", A, FIT);
    const raw = JSON.parse(JSON.stringify([win("w1", saved), win("w2", saved)]));
    const windows = sanitizeDocumentBackedPlotWindows(raw, new Set(["a"]));
    expect(windows.map((w) => (w.kind === "plot" ? w.document?.overlays?.fit?.y : null))).toEqual([FIT.y, FIT.y]);
  });
});
