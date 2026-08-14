import { beforeEach, describe, expect, it } from "vitest";

import { createFigureDocument, type FigureDocument } from "../lib/figureDocument";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import { libraryWindowLiveDrifted, resolveLibraryApply } from "./figurePublicationLibrary";
import type { FigurePublicationSession } from "./figureLifecycle";
import { useApp } from "./useApp";

// Item 1 (data loss, store-level unit coverage): resolveLibraryApply is the
// pure decision figureLifecycle.ts's applyFigurePublicationEdit defers to for
// the `library` session target. Building state through the real store (like
// figureLifecycle.test.ts does for editableFigureDirty/liveWindowDocument)
// rather than hand-typing a fake AppState -- these functions read enough of
// it that a partial stub would silently drift from the real shape.

const savedFigure = (over: Partial<FigureDocument> = {}): FigureDocument => ({
  ...createFigureDocument({
    id: "figure-lib-1",
    name: "Saved figure",
    datasetId: "d1",
    view: defaultPlotView(),
  }),
  ...over,
});

const window = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "Saved figure",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 600, h: 400 },
  z: 1,
  winState: "maximized",
  view: defaultPlotView(),
  document: savedFigure(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

const librarySession = (baseline: FigureDocument, draft: FigureDocument = baseline): FigurePublicationSession => ({
  target: "library",
  windowId: null,
  baseline,
  draft,
});

beforeEach(() => {
  useApp.setState({
    datasets: [{
      id: "d1",
      name: "Data",
      data: { time: [0, 1], values: [[2, 3]], labels: ["Y"], units: [""], metadata: {} },
    }],
    activeId: "d1",
    selectedIds: ["d1"],
    plotWindows: [],
    focusedWindowId: null,
    editableFigures: [savedFigure()],
    figurePublicationSession: null,
    history: [],
    future: [],
    ...defaultPlotView(),
  });
});

describe("libraryWindowLiveDrifted", () => {
  it("is false with no window sharing the document id", () => {
    const session = librarySession(savedFigure());
    expect(libraryWindowLiveDrifted(useApp.getState(), session)).toBe(false);
  });

  it("is false when a window shares the id but has not drifted from the baseline", () => {
    useApp.setState({ plotWindows: [window()], focusedWindowId: "w1" });
    const session = librarySession(savedFigure());
    expect(libraryWindowLiveDrifted(useApp.getState(), session)).toBe(false);
  });

  // The exact repro: an open window bound to the SAME saved figure has an
  // unsaved Stage edit (here, a live plotTitle change never routed through
  // saveFigure/applyFigurePublicationEdit) while a library-target preview is
  // open on that same document id.
  it("is true once the FOCUSED window sharing the id has an unsaved live edit", () => {
    useApp.setState({ plotWindows: [window()], focusedWindowId: "w1", plotTitle: "Live Stage edit" });
    const session = librarySession(savedFigure());
    expect(libraryWindowLiveDrifted(useApp.getState(), session)).toBe(true);
  });

  it("is false when the drifted window carries a DIFFERENT document id", () => {
    useApp.setState({
      plotWindows: [window({ document: savedFigure({ id: "different-figure" }) })],
      focusedWindowId: "w1",
      plotTitle: "Live Stage edit",
    });
    const session = librarySession(savedFigure());
    expect(libraryWindowLiveDrifted(useApp.getState(), session)).toBe(false);
  });
});

describe("resolveLibraryApply", () => {
  it("reports ready with no concurrent live edit -- the existing, unchanged contract", () => {
    const session = librarySession(savedFigure());
    const outcome = resolveLibraryApply(useApp.getState(), session);
    expect(outcome.kind).toBe("ready");
  });

  // Item 1: reproduces the finder's exact scenario at the pure-decision layer
  // (figureLifecycle.test.ts's "library target" describe block reproduces the
  // same scenario through the full store, one level up).
  it("refuses (stale) once a window sharing the document id has live-drifted, even though editableFigures itself is untouched", () => {
    useApp.setState({ plotWindows: [window()], focusedWindowId: "w1", plotTitle: "Live Stage edit" });
    const session = librarySession(savedFigure());
    const outcome = resolveLibraryApply(useApp.getState(), session);
    expect(outcome.kind).toBe("stale");
    expect(outcome.kind === "stale" && outcome.toastMsg).toContain("the plot changed while previewing");
  });

  it("still refuses (stale) for a saved-elsewhere change even with no open window", () => {
    const session = librarySession(savedFigure());
    useApp.setState({ editableFigures: [savedFigure({ name: "Renamed elsewhere" })] });
    const outcome = resolveLibraryApply(useApp.getState(), session);
    expect(outcome.kind).toBe("stale");
    expect(outcome.kind === "stale" && outcome.toastMsg).toContain("Cancel and reopen");
  });
});
