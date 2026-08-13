import { beforeEach, describe, expect, it } from "vitest";

import { createFigureDocument, type FigureDocument } from "../lib/figureDocument";
import type { FigureDoc } from "../lib/figuredoc";
import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import { editableFigureDirty, figurePublicationDirty, liveWindowDocument } from "./figureLifecycle";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const document = () => createFigureDocument({
  id: "figure-w1",
  name: "Current plot",
  datasetId: "d1",
  view: defaultPlotView(),
  publication: { overrides: { font_size: 10 }, seriesStyles: [{ color: "#123456" }] },
});

const window = (): PlotWindow => ({
  id: "w1",
  kind: "plot",
  title: "Current plot",
  datasetId: "d1",
  geometry: { x: 0, y: 0, w: 600, h: 400 },
  z: 1,
  winState: "maximized",
  view: defaultPlotView(),
  document: document(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
});

const legacyFigure = (overrides: Partial<FigureDoc> = {}): FigureDoc => ({
  id: "legacy-figure",
  name: "Legacy figure",
  datasetId: "d1",
  live: true,
  config: {
    xKey: null, yKeys: [0], xScale: "linear", yScale: "linear",
    title: "Legacy title", xLabel: "X", yLabel: "Y",
    style: "default", fmt: "pdf", dpi: 300, overrides: null, seriesStyles: null,
  },
  ...overrides,
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
    plotWindows: [window()],
    focusedWindowId: "w1",
    figureDocs: [],
    editableFigures: [],
    figurePublicationSession: null,
    history: [],
    future: [],
    ...defaultPlotView(),
  });
});

describe("editable figure lifecycle", () => {
  it("saves the focused live facade and reports later changes as dirty", () => {
    expect(editableFigureDirty(useApp.getState(), window())).toBe(true);
    expect(useApp.getState().saveFigure("w1")).toBe("figure-w1");
    expect(useApp.getState().editableFigures).toHaveLength(1);
    expect(editableFigureDirty(useApp.getState(), useApp.getState().plotWindows[0])).toBe(false);

    useApp.setState({ plotTitle: "Changed since save" });
    expect(editableFigureDirty(useApp.getState(), useApp.getState().plotWindows[0])).toBe(true);
    useApp.getState().saveFigure("w1");
    expect(useApp.getState().editableFigures[0].plot.view.plotTitle).toBe("Changed since save");
  });

  // Reached through the documented UI (import a file -> File > Save Editable
  // Figure) before this test existed: the DEFAULT main window is created at
  // store init, before any dataset exists, so its `title` is the "" sentinel
  // forever. The title BAR resolves that through displayedWindowTitle, so the
  // window plainly reads "Data" while `title` stays "" -- and the saved
  // figure landed named "", giving a nameless Library row, a bare glyph in
  // the Figure Page panel-source list, and the status `figure "" saved`.
  it("names a figure saved from an untitled window after what its title bar shows", () => {
    useApp.setState({ plotWindows: [{ ...window(), title: "", document: { ...document(), name: "" } }] });
    useApp.getState().saveFigure("w1");
    expect(useApp.getState().editableFigures[0].name).toBe("Data");
    expect(useApp.getState().status).toBe('figure "Data" saved');
  });

  it("falls back to Untitled graph when an untitled window has no dataset either", () => {
    useApp.setState({
      plotWindows: [{ ...window(), title: "", datasetId: null, document: { ...document(), name: "" } }],
    });
    useApp.getState().saveFigure("w1");
    expect(useApp.getState().editableFigures[0].name).toBe("Untitled graph");
  });

  it("never overrides a window's explicit title", () => {
    // The window() fixture is titled "Current plot"; resolving must be a
    // fallback for the blank sentinel only, never a rename.
    useApp.getState().saveFigure("w1");
    expect(useApp.getState().editableFigures[0].name).toBe("Current plot");
  });

  it("Save As assigns a new identity and updates the open window", () => {
    const id = useApp.getState().saveFigureAs("w1", "Analysis copy");
    expect(id).not.toBe("figure-w1");
    expect(useApp.getState().editableFigures[0]).toMatchObject({ id, name: "Analysis copy" });
    expect(useApp.getState().plotWindows[0]).toMatchObject({ title: "Analysis copy", document: { id } });
  });

  it("reopens, renames, duplicates, and undo-restores a deleted document", () => {
    useApp.getState().saveFigure("w1");
    useApp.getState().renameEditableFigure("figure-w1", "Renamed");
    const copyId = useApp.getState().duplicateEditableFigure("figure-w1");
    expect(useApp.getState().editableFigures.map((entry) => entry.name)).toEqual(["Renamed", "Renamed copy"]);
    const [source, copy] = useApp.getState().editableFigures;
    expect(copy.publication).toEqual(source.publication);
    expect(copy.publication).not.toBe(source.publication);

    useApp.getState().deleteEditableFigure(copyId!);
    expect(useApp.getState().editableFigures).toHaveLength(1);
    useApp.getState().undo();
    expect(useApp.getState().editableFigures).toHaveLength(2);

    useApp.getState().closeWindow("w1"); // last plot is protected, so create an independent reopen target
    useApp.setState({ plotWindows: [], focusedWindowId: null });
    const opened = useApp.getState().openEditableFigure("figure-w1");
    expect(opened).toBeTruthy();
    expect(useApp.getState().plotWindows.find((entry) => entry.id === opened)?.document?.id).toBe("figure-w1");
  });
});

describe("legacy publication figure promotion", () => {
  it("creates one fresh canonical editable copy without changing the legacy source and undo removes only the copy", () => {
    const legacy = legacyFigure();
    const before = structuredClone(legacy);
    useApp.setState({ figureDocs: [legacy] });
    const history = useApp.getState().history.length;

    const id = useApp.getState().promoteLegacyFigureDoc(legacy.id);
    const promoted = useApp.getState().editableFigures[0];
    expect(id).toBeTruthy();
    expect(id).not.toBe(legacy.id);
    expect(promoted).toMatchObject({
      id,
      name: "Legacy figure (editable copy)",
      bindings: { datasetId: "d1", yKeys: [0] },
      data: { mode: "live" },
    });
    expect(useApp.getState().figureDocs).toEqual([before]);
    expect(useApp.getState().history).toHaveLength(history + 1);

    useApp.getState().undo();
    expect(useApp.getState().editableFigures).toEqual([]);
    expect(useApp.getState().figureDocs).toEqual([before]);
  });

  it("promotes a frozen snapshot without a live dataset and opens it unbound", () => {
    const frozen = legacyFigure({
      id: "frozen-legacy",
      datasetId: "stale-id",
      live: false,
      dataSnapshot: { time: [0], values: [[3]], labels: ["Y"], units: [""], metadata: {} },
    });
    useApp.setState({ datasets: [], activeId: null, figureDocs: [frozen], plotWindows: [], focusedWindowId: null });

    const id = useApp.getState().promoteLegacyFigureDoc(frozen.id);
    expect(id).toBeTruthy();
    expect(useApp.getState().editableFigures[0]).toMatchObject({
      bindings: { datasetId: null },
      data: { mode: "frozen", snapshot: frozen.dataSnapshot },
    });
    const windowId = useApp.getState().openEditableFigure(id!);
    expect(useApp.getState().plotWindows.find((window) => window.id === windowId)).toMatchObject({
      datasetId: null,
      document: { id, data: { mode: "frozen" } },
    });
  });

  it("rejects a live figure whose exact dataset is unavailable without mutation", () => {
    const stale = legacyFigure({ datasetId: "gone" });
    useApp.setState({ figureDocs: [stale] });
    const before = structuredClone(useApp.getState().figureDocs);
    const history = useApp.getState().history.length;

    expect(useApp.getState().promoteLegacyFigureDoc(stale.id)).toBeNull();
    expect(useApp.getState().editableFigures).toEqual([]);
    expect(useApp.getState().figureDocs).toEqual(before);
    expect(useApp.getState().history).toHaveLength(history);
    expect(useApp.getState().status).toContain("source dataset is unavailable");
  });

  it("reports a malformed frozen source without recording a mutation", () => {
    const malformed = legacyFigure({ live: false, datasetId: null, dataSnapshot: undefined });
    useApp.setState({ figureDocs: [malformed] });
    const history = useApp.getState().history.length;

    expect(useApp.getState().promoteLegacyFigureDoc(malformed.id)).toBeNull();
    expect(useApp.getState().editableFigures).toEqual([]);
    expect(useApp.getState().history).toHaveLength(history);
    expect(useApp.getState().status).toContain("has no data snapshot");
  });
});

describe("canonical Publication Preview session", () => {
  it("begins from the focused live facade with isolated baseline and draft", () => {
    useApp.setState({ plotTitle: "Live title" });
    expect(useApp.getState().beginFigurePublicationEdit()).toBe(true);
    const session = useApp.getState().figurePublicationSession!;
    expect(session.baseline.plot.view.plotTitle).toBe("Live title");
    expect(session.draft).toEqual(session.baseline);
    expect(session.draft).not.toBe(session.baseline);

    useApp.getState().patchFigurePublicationDraft((draft) => ({ ...draft, name: "Draft name" }));
    expect(useApp.getState().figurePublicationSession?.baseline.name).toBe("Current plot");
    expect(figurePublicationDirty(useApp.getState().figurePublicationSession)).toBe(true);
  });

  it("refuses to replace an active Publication Preview session", () => {
    const source = document();
    expect(useApp.getState().beginFigurePublicationEdit()).toBe(true);
    useApp.getState().patchFigurePublicationDraft((draft) => ({ ...draft, name: "Dirty preview" }));
    const session = structuredClone(useApp.getState().figurePublicationSession);
    const history = useApp.getState().history.length;

    expect(useApp.getState().beginFigurePublicationEdit()).toBe(false);
    expect(useApp.getState().beginDetachedFigurePublicationEdit(source)).toBe(false);
    expect(useApp.getState().figurePublicationSession).toEqual(session);
    expect(useApp.getState().history).toHaveLength(history);
    expect(useApp.getState().status).toContain("finish or cancel");
  });

  it("fails closed before opening an invalid detached draft", () => {
    const missingSource = createFigureDocument({
      id: "missing", name: "Missing", datasetId: "gone", view: defaultPlotView(),
    });
    const malformedFrozen = {
      ...document(), id: "frozen", data: { mode: "frozen" },
    } as FigureDocument;
    const history = useApp.getState().history.length;

    expect(useApp.getState().beginDetachedFigurePublicationEdit(missingSource)).toBe(false);
    expect(useApp.getState().figurePublicationSession).toBeNull();
    expect(useApp.getState().beginDetachedFigurePublicationEdit(malformedFrozen)).toBe(false);
    expect(useApp.getState().editableFigures).toEqual([]);
    expect(useApp.getState().history).toHaveLength(history);
    expect(useApp.getState().status).toContain("frozen data is unavailable");
  });

  it("applies an unchanged detached draft once as a fresh editable figure and undo restores the prior state", () => {
    const source = document();
    const before = structuredClone(source);
    const history = useApp.getState().history.length;
    expect(useApp.getState().beginDetachedFigurePublicationEdit(source)).toBe(true);
    const draft = useApp.getState().figurePublicationSession!.draft;
    expect(draft.id).not.toBe(source.id);
    expect(draft).toMatchObject({ name: source.name, bindings: source.bindings });
    expect(useApp.getState().applyFigurePublicationEdit()).toBe(true);

    const state = useApp.getState();
    expect(state.editableFigures).toEqual([draft]);
    expect(state.editableFigures[0]).not.toBe(draft);
    expect(state.history).toHaveLength(history + 1);
    expect(state.figurePublicationSession).toBeNull();
    expect(state.figureBuilderOpen).toBe(false);
    expect(state.status).toContain("open it from Editable figures");
    expect(source).toEqual(before);

    state.undo();
    expect(useApp.getState().editableFigures).toEqual([]);
  });

  it("refuses a detached Apply when its live source disappears after preview begins", () => {
    expect(useApp.getState().beginDetachedFigurePublicationEdit(document())).toBe(true);
    const history = useApp.getState().history.length;
    useApp.setState({ datasets: [], activeId: null });

    expect(useApp.getState().applyFigurePublicationEdit()).toBe(false);
    expect(useApp.getState().editableFigures).toEqual([]);
    expect(useApp.getState().history).toHaveLength(history);
    expect(useApp.getState().figurePublicationSession).not.toBeNull();
    expect(useApp.getState().status).toContain("source dataset is unavailable");
  });

  it("keeps a detached draft transient on Cancel and persists its edits only on Apply", () => {
    const source = document();
    expect(useApp.getState().beginDetachedFigurePublicationEdit(source)).toBe(true);
    useApp.getState().patchFigurePublicationDraft((draft) => ({ ...draft, name: "Edited detached" }));
    const history = useApp.getState().history.length;
    useApp.getState().cancelFigurePublicationEdit();
    expect(useApp.getState().editableFigures).toEqual([]);
    expect(useApp.getState().history).toHaveLength(history);

    useApp.getState().beginDetachedFigurePublicationEdit(source);
    useApp.getState().patchFigurePublicationDraft((draft) => ({ ...draft, name: "Edited detached" }));
    expect(useApp.getState().applyFigurePublicationEdit()).toBe(true);
    expect(useApp.getState().editableFigures[0].name).toBe("Edited detached");
  });

  it("cancels with no persistent mutation or history entry", () => {
    useApp.getState().beginFigurePublicationEdit();
    useApp.getState().patchFigurePublicationDraft((draft) => ({ ...draft, name: "Discarded" }));
    const before = structuredClone(useApp.getState().plotWindows);
    const history = useApp.getState().history.length;
    useApp.getState().cancelFigurePublicationEdit();
    expect(useApp.getState().figurePublicationSession).toBeNull();
    expect(useApp.getState().plotWindows).toEqual(before);
    expect(useApp.getState().history).toHaveLength(history);
  });

  it("applies once through the window bridge, hydrates the focused facade, and leaves saved figures untouched", () => {
    useApp.getState().beginFigurePublicationEdit();
    useApp.getState().patchFigurePublicationDraft((draft) => ({
      ...draft,
      name: "Published",
      output: { ...draft.output, dpi: 600 },
      plot: { ...draft.plot, view: { ...draft.plot.view, plotTitle: "Published title" } },
    }));
    const history = useApp.getState().history.length;
    expect(useApp.getState().applyFigurePublicationEdit()).toBe(true);
    const state = useApp.getState();
    expect(state.history).toHaveLength(history + 1);
    expect(state.editableFigures).toEqual([]);
    expect(state.figurePublicationSession).toBeNull();
    expect(state.plotWindows[0]).toMatchObject({ title: "Published", document: { output: { dpi: 600 } } });
    expect(state.plotTitle).toBe("Published title");
  });

  it("rejects same-id concurrent focused-facade drift without recording history, and flags the session staleBaseline", () => {
    useApp.getState().beginFigurePublicationEdit();
    useApp.setState({ plotTitle: "Changed on Stage" });
    const history = useApp.getState().history.length;
    useToasts.setState({ toasts: [] });

    expect(useApp.getState().applyFigurePublicationEdit()).toBe(false);

    expect(useApp.getState().history).toHaveLength(history);
    expect(useApp.getState().plotWindows[0].document?.name).toBe("Current plot");
    expect(useApp.getState().figurePublicationSession).not.toBeNull();
    // Item 4: the session survives (nothing to discard) but is now flagged so
    // Apply stays a dead end until the user Cancels and reopens.
    expect(useApp.getState().figurePublicationSession?.staleBaseline).toBe(true);
    expect(useToasts.getState().toasts.some((t) => t.kind === "danger" && t.msg.includes("Cancel and reopen"))).toBe(true);

    // Apply keeps failing (never re-enables itself) once flagged, even though
    // nothing about the drift condition itself changed.
    expect(useApp.getState().applyFigurePublicationEdit()).toBe(false);
  });
});

describe("closeWindow and a window-target Publication Preview session (item 3a)", () => {
  it("clears the session, closes the builder, and toasts when its target window closes", () => {
    const w2 = useApp.getState().createWindow(null, undefined, "scratch");
    expect(useApp.getState().beginFigurePublicationEdit()).toBe(true); // targets the focused window, w1
    useToasts.setState({ toasts: [] });

    useApp.getState().closeWindow("w1");

    const s = useApp.getState();
    expect(s.plotWindows.map((w) => w.id)).toEqual([w2]);
    expect(s.figurePublicationSession).toBeNull();
    expect(s.figureBuilderOpen).toBe(false);
    expect(
      useToasts.getState().toasts.some((t) => t.kind === "danger" && t.msg.includes("its plot window was closed")),
    ).toBe(true);
  });

  it("leaves the session untouched when a DIFFERENT window closes", () => {
    const w2 = useApp.getState().createWindow(null, undefined, "scratch");
    expect(useApp.getState().beginFigurePublicationEdit()).toBe(true); // targets w1, not w2
    useToasts.setState({ toasts: [] });

    useApp.getState().closeWindow(w2);

    const s = useApp.getState();
    expect(s.figurePublicationSession).not.toBeNull();
    expect(s.figureBuilderOpen).toBe(true);
    expect(useToasts.getState().toasts).toHaveLength(0);
  });
});

// Edit a SAVED editable figure directly in Publication Preview, Apply
// replacing that same Library entry in place -- the third session target
// alongside `window` (a live focused facade) and `new-editable` (always
// creates fresh). Mirrors the `new-editable` begin/apply readiness gate and
// the `window` branch's stale-baseline discipline; see
// figurePublicationLibrary.ts for the shared pure decision logic.
describe("canonical Publication Preview session — library target", () => {
  const libraryFigure = (over: Partial<FigureDocument> = {}): FigureDocument => ({
    ...createFigureDocument({
      id: "figure-lib-1",
      name: "Saved figure",
      datasetId: "d1",
      view: defaultPlotView(),
    }),
    ...over,
  });

  it("begins from a saved figure with an isolated baseline/draft that KEEPS its own id", () => {
    const saved = libraryFigure();
    useApp.setState({ editableFigures: [saved] });
    expect(useApp.getState().beginFigurePublicationEditForFigure("figure-lib-1")).toBe(true);
    const session = useApp.getState().figurePublicationSession!;
    expect(session.target).toBe("library");
    expect(session.windowId).toBeNull();
    expect(session.draft.id).toBe("figure-lib-1");
    expect(session.baseline).toEqual(saved);
    expect(session.draft).not.toBe(session.baseline);
    expect(useApp.getState().figureBuilderOpen).toBe(true);
    // No window required -- opening from the Library is fully decoupled from the MDI model.
    expect(useApp.getState().plotWindows).toEqual([window()]);
  });

  it("returns false for an unknown figure id without opening a session", () => {
    expect(useApp.getState().beginFigurePublicationEditForFigure("does-not-exist")).toBe(false);
    expect(useApp.getState().figurePublicationSession).toBeNull();
  });

  it("refuses to replace an active session, same as the other begin* entry points", () => {
    const saved = libraryFigure();
    useApp.setState({ editableFigures: [saved] });
    expect(useApp.getState().beginFigurePublicationEditForFigure("figure-lib-1")).toBe(true);
    const before = structuredClone(useApp.getState().figurePublicationSession);

    expect(useApp.getState().beginFigurePublicationEditForFigure("figure-lib-1")).toBe(false);
    expect(useApp.getState().figurePublicationSession).toEqual(before);
    expect(useApp.getState().status).toContain("finish or cancel");
  });

  it("fails closed opening a figure whose live source is unavailable", () => {
    const saved = libraryFigure({ bindings: { ...libraryFigure().bindings, datasetId: "gone" } });
    useApp.setState({ editableFigures: [saved] });
    expect(useApp.getState().beginFigurePublicationEditForFigure("figure-lib-1")).toBe(false);
    expect(useApp.getState().figurePublicationSession).toBeNull();
    expect(useApp.getState().status).toContain("source dataset is unavailable");
  });

  it("applies once, REPLACING the same Library entry (never duplicating it), as one undoable edit", () => {
    const saved = libraryFigure();
    useApp.setState({ editableFigures: [saved] });
    const history = useApp.getState().history.length;
    expect(useApp.getState().beginFigurePublicationEditForFigure("figure-lib-1")).toBe(true);
    useApp.getState().patchFigurePublicationDraft((draft) => ({ ...draft, name: "Renamed via preview" }));

    expect(useApp.getState().applyFigurePublicationEdit()).toBe(true);
    const state = useApp.getState();
    expect(state.editableFigures).toHaveLength(1);
    expect(state.editableFigures[0]).toMatchObject({ id: "figure-lib-1", name: "Renamed via preview" });
    expect(state.history).toHaveLength(history + 1);
    expect(state.figurePublicationSession).toBeNull();
    expect(state.figureBuilderOpen).toBe(false);
    expect(state.status).toContain("applied publication preview");

    state.undo();
    expect(useApp.getState().editableFigures[0].name).toBe("Saved figure");
  });

  it("Cancel makes no persistent mutation or history entry", () => {
    const saved = libraryFigure();
    useApp.setState({ editableFigures: [saved] });
    const history = useApp.getState().history.length;
    useApp.getState().beginFigurePublicationEditForFigure("figure-lib-1");
    useApp.getState().patchFigurePublicationDraft((draft) => ({ ...draft, name: "Discarded" }));

    useApp.getState().cancelFigurePublicationEdit();
    expect(useApp.getState().editableFigures).toEqual([saved]);
    expect(useApp.getState().history).toHaveLength(history);
    expect(useApp.getState().figurePublicationSession).toBeNull();
  });

  it("refuses Apply and flags staleBaseline once the figure is DELETED elsewhere while previewing", () => {
    const saved = libraryFigure();
    useApp.setState({ editableFigures: [saved] });
    useApp.getState().beginFigurePublicationEditForFigure("figure-lib-1");
    useApp.getState().patchFigurePublicationDraft((draft) => ({ ...draft, name: "Edited in preview" }));
    useApp.getState().deleteEditableFigure("figure-lib-1"); // e.g. the Library panel's delete button
    const history = useApp.getState().history.length;
    useToasts.setState({ toasts: [] });

    expect(useApp.getState().applyFigurePublicationEdit()).toBe(false);

    expect(useApp.getState().history).toHaveLength(history);
    expect(useApp.getState().editableFigures).toEqual([]);
    expect(useApp.getState().figurePublicationSession?.staleBaseline).toBe(true);
    expect(useApp.getState().status).toContain("target changed");
    expect(
      useToasts.getState().toasts.some((t) => t.kind === "danger" && t.msg.includes("deleted while previewing")),
    ).toBe(true);
  });

  it("refuses Apply and flags staleBaseline once the figure is EDITED elsewhere (renamed) while previewing", () => {
    const saved = libraryFigure();
    useApp.setState({ editableFigures: [saved] });
    useApp.getState().beginFigurePublicationEditForFigure("figure-lib-1");
    useApp.getState().patchFigurePublicationDraft((draft) => ({ ...draft, name: "Edited in preview" }));
    useApp.getState().renameEditableFigure("figure-lib-1", "Renamed from the Library panel");
    const history = useApp.getState().history.length;
    useToasts.setState({ toasts: [] });

    expect(useApp.getState().applyFigurePublicationEdit()).toBe(false);

    expect(useApp.getState().history).toHaveLength(history);
    expect(useApp.getState().editableFigures[0].name).toBe("Renamed from the Library panel");
    expect(useApp.getState().figurePublicationSession?.staleBaseline).toBe(true);
    expect(
      useToasts.getState().toasts.some((t) => t.kind === "danger" && t.msg.includes("Cancel and reopen")),
    ).toBe(true);

    // Never re-enables itself once flagged, even though nothing about the
    // drift condition changes -- same discipline as the window target.
    expect(useApp.getState().applyFigurePublicationEdit()).toBe(false);
  });

  it("refuses Apply when the live source becomes unavailable after the session began", () => {
    const saved = libraryFigure();
    useApp.setState({ editableFigures: [saved] });
    useApp.getState().beginFigurePublicationEditForFigure("figure-lib-1");
    const history = useApp.getState().history.length;
    useApp.setState({ datasets: [] });

    expect(useApp.getState().applyFigurePublicationEdit()).toBe(false);
    expect(useApp.getState().history).toHaveLength(history);
    expect(useApp.getState().editableFigures).toEqual([saved]);
    expect(useApp.getState().figurePublicationSession).not.toBeNull();
    expect(useApp.getState().status).toContain("source dataset is unavailable");
  });

  it("syncs a NON-focused open window sharing the document's id, without touching the live singletons", () => {
    const saved = libraryFigure();
    const w2: PlotWindow = { ...window(), id: "w2", title: "Saved figure", document: libraryFigure() };
    useApp.setState({
      editableFigures: [saved],
      plotWindows: [window(), w2], // w1 (unrelated document) stays focused
      plotTitle: "Untouched",
    });
    useApp.getState().beginFigurePublicationEditForFigure("figure-lib-1");
    useApp.getState().patchFigurePublicationDraft((draft) => ({
      ...draft,
      plot: { ...draft.plot, view: { ...draft.plot.view, plotTitle: "New title" } },
    }));

    expect(useApp.getState().applyFigurePublicationEdit()).toBe(true);
    const state = useApp.getState();
    expect(state.plotWindows.find((w) => w.id === "w2")?.document?.plot.view.plotTitle).toBe("New title");
    // w1 is the FOCUSED window and carries an unrelated document -- its live
    // singletons must not be disturbed by an update that targets a different figure.
    expect(state.plotTitle).toBe("Untouched");
  });

  it("syncs AND hydrates the live singletons once the matching window IS focused", () => {
    const saved = libraryFigure();
    const w1: PlotWindow = { ...window(), id: "w1", title: "Saved figure", document: libraryFigure() };
    useApp.setState({
      editableFigures: [saved],
      plotWindows: [w1],
      focusedWindowId: "w1",
      plotTitle: "",
    });
    useApp.getState().beginFigurePublicationEditForFigure("figure-lib-1");
    useApp.getState().patchFigurePublicationDraft((draft) => ({
      ...draft,
      plot: { ...draft.plot, view: { ...draft.plot.view, plotTitle: "New title" } },
    }));

    expect(useApp.getState().applyFigurePublicationEdit()).toBe(true);
    const state = useApp.getState();
    expect(state.editableFigures[0].plot.view.plotTitle).toBe("New title");
    expect(state.plotWindows[0].document?.plot.view.plotTitle).toBe("New title");
    // The critical assertion (item 2's window-sync investigation): the live
    // top-level singletons were hydrated too, so the NEXT liveWindowDocument
    // read (saveFigure, editableFigureDirty, ...) sees the applied edit
    // instead of silently reverting it back to the pre-Apply Stage state.
    expect(state.plotTitle).toBe("New title");
    expect(liveWindowDocument(state, state.plotWindows[0])?.plot.view.plotTitle).toBe("New title");
  });
});
