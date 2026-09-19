// Characterization tests for the WORKSPACE HYDRATION domain (audit P4.1 —
// "characterization tests first" before a god-module decomposition, the
// FOURTH domain). The domain: `loadWorkspace` (replace the whole library
// from a restored/parsed .dwk — the autosave restore on startup AND an
// explicit File > Open .dwk both run it) and `appendWorkspace` (Origin's
// "Append Project", MAIN_PLAN #16 — the additive opposite: only the flat
// dataset list + referenced workbooks join the CURRENT library). The
// architecture.test.ts pin history (2122 -> 2012 note) already named
// `loadWorkspace` (170 lines) as the obvious next P4.1 domain once the third
// domain (the bulk view appliers) landed.
//
// `appendWorkspace` itself is a ONE-LINE delegate to
// `runAppendWorkspace` (store/workspaceIO.ts, MAIN_PLAN #16) — that function
// is NOT moving (workspaceIO.ts is its own module, already below the
// store-size pin), so this file characterizes the delegate's observable
// behavior through the public action, not a second copy of workspaceIO's own
// coverage.
//
// What each spec pins:
//   1. the EXACT set of top-level store keys the call changes (a whole
//      `getState()` snapshot diffed by identity, after poisoning every field
//      either action writes to its own DEFAULT value — otherwise a writer
//      that "resets" a field back to what it already was would be invisible,
//      the hole review finding F4/F3 found on the earlier two domains), and
//   2. the observable results, the undo label pushed (or that none is), and
//      the toast text on a no-op branch.
//
// `loadWorkspace` has no early-return branch (it always replaces the whole
// state), but it has two conditionally-PRESENT keys in its return literal:
//   - `toolWindowLayout` is present only when `skipLayout` is falsy (PR E2's
//     "Open without layout…" OMITS the key entirely so `set()`'s merge
//     leaves the existing layout untouched — not "resets it to {}").
//   - the ~35 `PlotView` fields (`lib/plotview.ts`'s `VIEW_KEYS`) that are
//     NOT already covered by the explicit ternary block (yScale, xScale,
//     showGrid, showLegend, legendPos, legendXY, legendFrameXY, legendStatic,
//     legendTitle, axisLabelOffsets, axisLabelStyles, plotTemplate,
//     showAxisBox, stackMode, insetMode, polarMode, statMode, xFmt, yFmt,
//     y2Fmt, plotTitle, xAxisLabel, yAxisLabel, refLines, annotations,
//     regionShades, shapes, waterfall, panelFit, pageSetup) are present only
//     when a persisted plot-window layout actually restores
//     (`restoredHasPlot` — `...(restoredView ?? {})`); on the legacy/fresh
//     path they are OMITTED, so a poisoned value on one of them SURVIVES the
//     load untouched. Both branches are pinned below.
//
// Nothing in this file may change when the cluster moves out of
// store/useApp.ts except the module it imports (it imports only `./useApp`,
// so in the event: nothing at all).
//
// Deliberately NOT a duplicate of store/useApp.test.ts's "useApp
// loadWorkspace"/"useApp appendWorkspace" describes: those assert individual
// decoded fields (folder migration, workbook round-trip, librarySelection
// precedence, …) and say nothing about the complement — which OTHER store
// fields moved, or stayed untouched. That complement is what a verbatim
// extraction has to preserve, so it is what this file pins.

import { beforeEach, describe, expect, it } from "vitest";

import { defaultPlotView, type PlotWindow } from "../lib/plotview";
import type { Dataset, DataStruct } from "../lib/types";
import type { LoadedWorkspace } from "../lib/workspace";
import { useApp } from "./useApp";
import { useToasts } from "./toasts";

// ── fixtures ────────────────────────────────────────────────────────────────

const raw: DataStruct = {
  time: [1, 2, 3],
  values: [[10], [20], [30]],
  labels: ["m"],
  units: ["emu"],
  metadata: {},
};

const ds = (id: string, name = id): Dataset => ({ id, name, data: raw });

const win = (over: Partial<PlotWindow> = {}): PlotWindow => ({
  id: "restored-w1",
  kind: "plot",
  title: "",
  datasetId: null,
  geometry: { x: 0, y: 0, w: 480, h: 360 },
  z: 0,
  winState: "normal",
  view: defaultPlotView(),
  bg: "theme",
  linkGroup: null,
  pinned: false,
  ...over,
});

/** A fully-populated LoadedWorkspace (appendWorkspace's arg type) — every
 *  field explicit so a hand-built fixture never silently reads `undefined`
 *  off an optional field `mergeWorkspace` actually consults. Mirrors
 *  store/useApp.test.ts's own `asLoaded` helper. */
function asLoaded(datasets: Dataset[]): LoadedWorkspace {
  return {
    datasets,
    folders: [],
    workbooks: [],
    activeId: null,
    selectedIds: [],
    expandedFolders: [],
    originFigures: [],
    originFidelity: [],
    smartFolders: [],
    reports: [],
    macroSteps: [],
    recalcMode: "auto",
    figureDocs: [],
    editableFigures: [],
    pages: [],
    migrationWarnings: [],
    plotWindows: [],
    focusedWindowId: null,
    toolWindowLayout: {},
    savedPlotSpecs: [],
    techniqueViewMemory: {},
    savedRois: [],
    quickPlotTemplates: [],
    librarySelection: null,
    workbookLastChild: {},
    expandedWorkbookIds: [],
    collections: [],
    visibleDetailsColumns: [],
    plotRecipes: [],
    recipeSourcesComplete: true,
  };
}

// ── harness ─────────────────────────────────────────────────────────────────

type Snap = Record<string, unknown>;

const snapshot = (): Snap => ({ ...(useApp.getState() as unknown as Snap) });

/** Top-level store keys whose value changed identity, sorted. */
function changedSince(before: Snap): string[] {
  const after = useApp.getState() as unknown as Snap;
  return Object.keys(after)
    .filter((k) => after[k] !== before[k])
    .sort();
}

const labels = (): string[] => useApp.getState().history.map((h) => h.label);
const toastTexts = (): string[] => useToasts.getState().toasts.map((t) => t.msg);

/** POISON. Every field either action writes to a DEFAULT value gets a
 *  NON-default value first, so "wrote the default" still registers as a
 *  diff. Includes every `lib/plotview.ts` VIEW_KEY (the `...(restoredView ??
 *  {})` spread's whole field set) — poisoning all of them, not just the ones
 *  the explicit ternary block also lists, is what makes BOTH the
 *  restored-layout branch (spread fires, poison replaced) and the
 *  legacy/fresh branch (spread doesn't fire, poison SURVIVES) observable. */
function poison(): void {
  useApp.setState({
    folders: [{ id: "stale-folder", name: "STALE", parentId: null, order: 0 }],
    workbooks: [{ id: "stale-wb", name: "STALE WB" }],
    expandedFolders: ["stale-folder"],
    librarySelection: { kind: "folder", id: "stale-folder" },
    expandedWorkbookIds: ["stale-wb"],
    workbookLastChild: { "stale-wb": "stale-child" },
    worksheetId: "stale-ws",
    worksheetSelections: { "stale-ws": { datasetId: "stale-ws", rows: [0] } },
    originFigures: [{ id: "stale-fig" } as unknown as ReturnType<typeof useApp.getState>["originFigures"][number]],
    originFidelity: [{ figureId: "stale-fig" } as unknown as ReturnType<typeof useApp.getState>["originFidelity"][number]],
    smartFolders: [{ id: "stale-sf", name: "STALE" } as unknown as ReturnType<typeof useApp.getState>["smartFolders"][number]],
    reports: [{ id: "stale-report" } as unknown as ReturnType<typeof useApp.getState>["reports"][number]],
    openReportId: "stale-report",
    macroSteps: [{ code: "stale();", label: "stale" } as unknown as ReturnType<typeof useApp.getState>["macroSteps"][number]],
    recalcMode: "manual",
    figureDocs: [{ id: "stale-fdoc" } as unknown as ReturnType<typeof useApp.getState>["figureDocs"][number]],
    editableFigures: [{ id: "stale-efig" } as unknown as ReturnType<typeof useApp.getState>["editableFigures"][number]],
    pages: [{ id: "stale-page" } as unknown as ReturnType<typeof useApp.getState>["pages"][number]],
    figureDocSeed: { kind: "stale" } as unknown as ReturnType<typeof useApp.getState>["figureDocSeed"],
    figurePublicationSession: { id: "stale-session" } as unknown as ReturnType<typeof useApp.getState>["figurePublicationSession"],
    pageDocSeed: { kind: "stale" } as unknown as ReturnType<typeof useApp.getState>["pageDocSeed"],
    savedPlotSpecs: [{ id: "stale-spec" } as unknown as ReturnType<typeof useApp.getState>["savedPlotSpecs"][number]],
    quickPlotTemplates: [{ id: "stale-tpl" } as unknown as ReturnType<typeof useApp.getState>["quickPlotTemplates"][number]],
    savedRois: [{ id: "stale-roi" } as unknown as ReturnType<typeof useApp.getState>["savedRois"][number]],
    mapViews: { "stale-ds": {} as unknown } as unknown as ReturnType<typeof useApp.getState>["mapViews"],
    mapPaintedLimits: { "stale-ds": {} as unknown } as unknown as ReturnType<typeof useApp.getState>["mapPaintedLimits"],
    collections: [{ id: "stale-coll" } as unknown as ReturnType<typeof useApp.getState>["collections"][number]],
    plotRecipes: [{ id: "stale-recipe" } as unknown as ReturnType<typeof useApp.getState>["plotRecipes"][number]],
    recipeSourcesComplete: false,
    visibleDetailsColumns: ["notes"] as unknown as ReturnType<typeof useApp.getState>["visibleDetailsColumns"],
    activePlotSpecId: "stale-spec",
    quickFigureBuilderDatasetId: "stale-ds",
    separatePreview: { id: "stale-sep" } as unknown as ReturnType<typeof useApp.getState>["separatePreview"],
    reimportAllRows: [{ id: "stale-row" }] as unknown as ReturnType<typeof useApp.getState>["reimportAllRows"],
    reimportAllBusy: true,
    reimportAllCommitted: { at: 1 } as unknown as ReturnType<typeof useApp.getState>["reimportAllCommitted"],
    pendingRecipeApplication: { id: "stale-pending" } as unknown as ReturnType<typeof useApp.getState>["pendingRecipeApplication"],
    staleDatasets: ["stale-ds"],
    staleFits: ["stale-ds"],
    xKey: 7,
    yKeys: [7],
    groupKey: 7,
    facetKey: 7,
    y2Keys: [7],
    y2Lim: [-1, -1],
    y2Scale: "log",
    y2Step: 99,
    y2AxisLabel: "STALE Y2",
    seriesStyles: { 7: { color: "#123456" } },
    seriesLabels: { 7: "stale" },
    errKeys: { 7: 8 },
    seriesOrder: [7],
    hiddenChannels: [7],
    xLim: [-1, -1],
    yLim: [-1, -1],
    xStep: 99,
    yStep: 99,
    // The rest of VIEW_KEYS, not already listed above (only reachable
    // through the `...(restoredView ?? {})` spread).
    yScale: "log",
    xScale: "log",
    showGrid: false,
    showLegend: false,
    legendPos: "sw",
    legendXY: [0.4, 0.4],
    legendFrameXY: [0.3, 0.3],
    legendStatic: true,
    legendTitle: "stale title",
    axisLabelOffsets: { x: 5 } as unknown as ReturnType<typeof useApp.getState>["axisLabelOffsets"],
    axisLabelStyles: { x: { bold: true } } as unknown as ReturnType<typeof useApp.getState>["axisLabelStyles"],
    plotTemplate: "publication",
    showAxisBox: false,
    stackMode: true,
    insetMode: true,
    polarMode: true,
    statMode: true,
    xFmt: { mode: "fixed", digits: 9 },
    yFmt: { mode: "fixed", digits: 9 },
    y2Fmt: { mode: "fixed", digits: 9 },
    plotTitle: "STALE TITLE",
    xAxisLabel: "STALE X",
    yAxisLabel: "STALE Y",
    refLines: [{ id: "ref-stale" } as unknown as ReturnType<typeof useApp.getState>["refLines"][number]],
    annotations: [{ id: "ann-stale" } as unknown as ReturnType<typeof useApp.getState>["annotations"][number]],
    regionShades: [{ id: "shade-stale" } as unknown as ReturnType<typeof useApp.getState>["regionShades"][number]],
    shapes: [{ id: "shape-stale" } as unknown as ReturnType<typeof useApp.getState>["shapes"][number]],
    waterfall: 42,
    panelFit: "page",
    pageSetup: {
      width: 42, height: 42, unit: "in",
      margins: { left: 1, right: 1, top: 1, bottom: 1 },
      aspectDerived: false,
    } as unknown as ReturnType<typeof useApp.getState>["pageSetup"],
    // `focusTransientReset()` (store/windows.ts) is part of every
    // `loadWorkspace` call, so poison its whole field list too.
    composition: { kind: "facet", panels: [] } as unknown as ReturnType<typeof useApp.getState>["composition"],
    rsmPeaks: { datasetId: "stale-ds", peaks: [] } as unknown as ReturnType<typeof useApp.getState>["rsmPeaks"],
    integral: { value: 1 } as unknown as ReturnType<typeof useApp.getState>["integral"],
    fwhmResult: { value: 1 } as unknown as ReturnType<typeof useApp.getState>["fwhmResult"],
    qfitRoi: { datasetId: "stale-ds" } as unknown as ReturnType<typeof useApp.getState>["qfitRoi"],
    qfitResult: { value: 1 } as unknown as ReturnType<typeof useApp.getState>["qfitResult"],
    qfitBusy: true,
    qfitError: "stale",
    gadgetBusy: true,
    gadgetError: "stale",
    gadgetIntegrateResult: { value: 1 } as unknown as ReturnType<typeof useApp.getState>["gadgetIntegrateResult"],
    gadgetStatsResult: { value: 1 } as unknown as ReturnType<typeof useApp.getState>["gadgetStatsResult"],
    gadgetDerivResult: { value: 1 } as unknown as ReturnType<typeof useApp.getState>["gadgetDerivResult"],
    gadgetFftPreview: { value: 1 } as unknown as ReturnType<typeof useApp.getState>["gadgetFftPreview"],
    gadgetCursors: [1, 2] as unknown as ReturnType<typeof useApp.getState>["gadgetCursors"],
    gadgetCursorResult: { value: 1 } as unknown as ReturnType<typeof useApp.getState>["gadgetCursorResult"],
    techniqueViewMemory: { XRD: {} } as unknown as ReturnType<typeof useApp.getState>["techniqueViewMemory"],
    toolWindowLayout: { stale: { x: 1, y: 1, width: 1, height: null, collapsed: false } },
    fitOverlay: { datasetId: "stale-ds" } as unknown as ReturnType<typeof useApp.getState>["fitOverlay"],
    peakOverlay: { datasetId: "stale-ds" } as unknown as ReturnType<typeof useApp.getState>["peakOverlay"],
    baselineOverlay: { datasetId: "stale-ds" } as unknown as ReturnType<typeof useApp.getState>["baselineOverlay"],
    peakWizardEdit: { datasetId: "stale-ds" } as unknown as ReturnType<typeof useApp.getState>["peakWizardEdit"],
    stageTab: "worksheet",
  });
}

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [],
    activeId: null,
    selectedIds: [],
    history: [],
    future: [],
  });
  poison();
});

// ── loadWorkspace ───────────────────────────────────────────────────────────

describe("loadWorkspace — legacy/fresh path (no persisted plot-window layout)", () => {
  // No activeId/datasets change here (both already null/[]), which is
  // exactly why this key set has neither — the baseline for every other
  // spec's DELTA in this describe block. None of the restoredView-only
  // VIEW_KEYS (yScale, showGrid, legendPos, plotTitle, annotations, …)
  // appear: the `...(restoredView ?? {})` spread never fires on this path,
  // so their poisoned values SURVIVE untouched — the behavior this whole
  // describe block exists to pin.
  it("a minimal fresh workspace (no datasets, no persisted layout) writes exactly this key set", () => {
    const before = snapshot();
    useApp.getState().loadWorkspace({ datasets: [] });
    expect(changedSince(before)).toEqual([
      "activePlotSpecId",
      "baselineOverlay",
      "collections",
      "composition",
      "datasets",
      "editableFigures",
      "errKeys",
      "expandedFolders",
      "expandedWorkbookIds",
      "facetKey",
      "figureDocSeed",
      "figureDocs",
      "figurePublicationSession",
      "fitOverlay",
      "focusedWindowId",
      "folders",
      "fwhmResult",
      "gadgetBusy",
      "gadgetCursorResult",
      "gadgetCursors",
      "gadgetDerivResult",
      "gadgetError",
      "gadgetFftPreview",
      "gadgetIntegrateResult",
      "gadgetStatsResult",
      "groupKey",
      "hiddenChannels",
      "integral",
      "librarySelection",
      "macroSteps",
      "mapPaintedLimits",
      "mapViews",
      "openReportId",
      "originFidelity",
      "originFigures",
      "pageDocSeed",
      "pages",
      "peakOverlay",
      "peakWizardEdit",
      "pendingRecipeApplication",
      "plotRecipes",
      "plotWindows",
      "qfitBusy",
      "qfitError",
      "qfitResult",
      "qfitRoi",
      "quickFigureBuilderDatasetId",
      "quickPlotTemplates",
      "recalcMode",
      "recipeSourcesComplete",
      "reimportAllBusy",
      "reimportAllCommitted",
      "reimportAllRows",
      "reports",
      "rsmPeaks",
      "savedPlotSpecs",
      "savedRois",
      "selectedIds",
      "separatePreview",
      "seriesLabels",
      "seriesOrder",
      "seriesStyles",
      "smartFolders",
      "staleDatasets",
      "staleFits",
      "status",
      "techniqueViewMemory",
      "toolWindowLayout",
      "visibleDetailsColumns",
      "workbookLastChild",
      "workbooks",
      "worksheetId",
      "worksheetSelections",
      "xKey",
      "xLim",
      "xStep",
      "y2AxisLabel",
      "y2Keys",
      "y2Lim",
      "y2Scale",
      "y2Step",
      "yKeys",
      "yLim",
      "yStep",
    ]);
  });

  it("pushes NO undo entry and records NO macro step", () => {
    useApp.setState({ macroRecording: true, macroSteps: [] });
    useApp.getState().loadWorkspace({ datasets: [] });
    expect(labels()).toEqual([]);
    expect(useApp.getState().macroSteps).toEqual([]);
    useApp.setState({ macroRecording: false, macroSteps: [] });
  });

  it("with datasets present, ALSO changes datasets/activeId and reports the count in status", () => {
    const before = snapshot();
    useApp.getState().loadWorkspace({ datasets: [ds("w1"), ds("w2")] });
    const changed = changedSince(before);
    expect(changed).toContain("datasets");
    expect(changed).toContain("activeId");
    expect(useApp.getState().activeId).toBe("w1"); // first dataset becomes active
    expect(useApp.getState().status).toBe("loaded workspace — 2 datasets");
  });

  // toolWindowLayout is a KEY that is either present (written) or absent
  // (left alone) in the return literal — not a value ternary like every
  // other field — so it needs its own before/after pair rather than a slot
  // in the big key-set list above.
  it("skipLayout: true OMITS toolWindowLayout from the write — the poisoned map survives", () => {
    const poisoned = useApp.getState().toolWindowLayout;
    useApp.getState().loadWorkspace(
      { datasets: [], toolWindowLayout: { fresh: { x: 9, y: 9, width: 9, height: null, collapsed: false } } },
      { skipLayout: true },
    );
    expect(useApp.getState().toolWindowLayout).toBe(poisoned); // same reference — untouched
  });

  it("skipLayout: false (default) DOES write toolWindowLayout from the doc", () => {
    useApp.getState().loadWorkspace({
      datasets: [],
      toolWindowLayout: { fresh: { x: 9, y: 9, width: 9, height: null, collapsed: false } },
    });
    expect(useApp.getState().toolWindowLayout).toEqual({
      fresh: { x: 9, y: 9, width: 9, height: null, collapsed: false },
    });
  });

  // v1/legacy compat: a doc with no folder tree, only `Dataset.group`
  // strings — project-organization plan item 6.
  it("migrates a v1 doc's legacy `group` strings into a root folder", () => {
    useApp.getState().loadWorkspace({
      datasets: [{ ...ds("w1"), group: "Batch A" }, { ...ds("w2"), group: "Batch A" }],
    });
    const s = useApp.getState();
    expect(s.folders).toHaveLength(1);
    expect(s.folders[0].name).toBe("Batch A");
    expect(s.expandedFolders).toContain(s.folders[0].id);
  });

  // L0.25: a restored librarySelection wins OUTRIGHT — selectedIds is never
  // synthesized to [active] alongside it.
  it("a restored librarySelection wins outright over the [active] selectedIds synthesis", () => {
    useApp.getState().loadWorkspace({
      datasets: [ds("w1")],
      activeId: "w1",
      selectedIds: [],
      librarySelection: { kind: "folder", id: "f1" },
    });
    const s = useApp.getState();
    expect(s.librarySelection).toEqual({ kind: "folder", id: "f1" });
    expect(s.selectedIds).toEqual([]);
  });

  it("a stale/invalid persisted activeId falls back to the first dataset", () => {
    useApp.getState().loadWorkspace({ datasets: [ds("w1"), ds("w2")], activeId: "nope" });
    expect(useApp.getState().activeId).toBe("w1");
  });

  it("does not leak the previous project's workbooks into one with none", () => {
    useApp.getState().loadWorkspace({ datasets: [ds("w1")], workbooks: [{ id: "wb1", name: "Old Book" }] });
    expect(useApp.getState().workbooks).toEqual([{ id: "wb1", name: "Old Book" }]);
    useApp.getState().loadWorkspace({ datasets: [ds("w2")] });
    expect(useApp.getState().workbooks).toEqual([]);
  });
});

describe("loadWorkspace — restored plot-window layout path (restoredHasPlot true)", () => {
  it("ADDITIONALLY writes every PlotView field the legacy path leaves alone", () => {
    const before = snapshot();
    useApp.getState().loadWorkspace({
      datasets: [ds("w1")],
      plotWindows: [
        win({
          id: "pw1",
          datasetId: "w1",
          view: { ...defaultPlotView(), plotTitle: "Restored Title" },
        }),
      ],
      focusedWindowId: "pw1",
    });
    const changed = changedSince(before);
    for (const viewKey of [
      "yScale", "xScale", "showGrid", "showLegend", "legendPos", "legendXY",
      "legendFrameXY", "legendStatic", "legendTitle", "axisLabelOffsets",
      "axisLabelStyles", "plotTemplate", "showAxisBox", "stackMode",
      "insetMode", "polarMode", "statMode", "xFmt", "yFmt", "y2Fmt",
      "plotTitle", "xAxisLabel", "yAxisLabel", "refLines", "annotations",
      "regionShades", "shapes", "waterfall", "panelFit", "pageSetup",
    ]) {
      expect(changed, `expected ${viewKey} to be written by the restored-layout branch`).toContain(viewKey);
    }
    const s = useApp.getState();
    expect(s.showGrid).toBe(true); // defaultPlotView()'s value -- differs from poison's `false`
    expect(s.plotTitle).toBe("Restored Title");
    expect(s.stackMode).toBe(false); // defaultPlotView()'s value -- differs from poison's `true`
    expect(s.plotWindows.map((w) => w.id)).toEqual(["pw1"]);
    expect(s.focusedWindowId).toBe("pw1");
  });

  it("skipLayout: true ignores a persisted layout even when present — falls back to the fresh single window", () => {
    useApp.getState().loadWorkspace(
      {
        datasets: [ds("w1")],
        plotWindows: [win({ id: "pw1", datasetId: "w1" })],
        focusedWindowId: "pw1",
      },
      { skipLayout: true },
    );
    const s = useApp.getState();
    expect(s.plotWindows.map((w) => w.id)).not.toEqual(["pw1"]);
    expect(s.plotTitle).toBe("STALE TITLE"); // the restoredView spread never fires
  });

  it("a doc whose surviving windows are all non-plot still gets a fresh maximized plot window", () => {
    useApp.getState().loadWorkspace({
      datasets: [ds("w1")],
      plotWindows: [{ ...win({ id: "snap1" }), kind: "snapshot" } as unknown as PlotWindow],
    });
    const s = useApp.getState();
    expect(s.plotWindows.some((w) => w.kind === "plot")).toBe(true);
    expect(s.plotTitle).toBe("STALE TITLE"); // no plot window restored -> legacy/fresh path
  });
});

// P2.8 review round 3 finding 2: `mapPaintedLimits` is per-dataset TRANSIENT
// paint state, reset unconditionally on every load (not carried over even
// when `mapViews` restores) — a reopened project's dataset ids can collide
// with the previous project's, leaving a stale "effective" pair on screen.
describe("loadWorkspace — mapPaintedLimits / mapViews (P2.8)", () => {
  it("ALWAYS clears mapPaintedLimits to {} — never carried over from the previous project", () => {
    useApp.getState().loadWorkspace({ datasets: [ds("w1")] });
    expect(useApp.getState().mapPaintedLimits).toEqual({});
  });

  it("restores mapViews only for datasets THIS load actually has", () => {
    useApp.getState().loadWorkspace({
      datasets: [ds("w1")],
      mapViews: {
        w1: { colorLimits: [0, 1] } as unknown as ReturnType<typeof useApp.getState>["mapViews"][string],
        "not-loaded": { colorLimits: [0, 1] } as unknown as ReturnType<typeof useApp.getState>["mapViews"][string],
      },
    });
    const mv = useApp.getState().mapViews;
    expect(Object.keys(mv)).toEqual(["w1"]);
  });
});

// ── appendWorkspace ─────────────────────────────────────────────────────────
//
// A one-line delegate to `runAppendWorkspace` (store/workspaceIO.ts) — not
// moving. Characterized here anyway (per the domain's own contract: every
// action, every branch) so the extraction's byte-identical delegate call is
// provably still wired to the same function with the same arguments.

describe("appendWorkspace — the additive .dwk join", () => {
  it("an empty incoming workspace changes NOTHING and toasts, pushing no undo entry", () => {
    useApp.setState({ datasets: [ds("d1")], activeId: "d1" });
    const before = snapshot();
    useApp.getState().appendWorkspace(asLoaded([]));
    expect(changedSince(before)).toEqual([]);
    expect(toastTexts()).toEqual(["workspace has no datasets to append"]);
    expect(labels()).toEqual([]);
  });

  it("a non-empty incoming workspace writes exactly this key set and pushes ONE undo entry", () => {
    useApp.setState({ datasets: [ds("d1")], activeId: "d1" });
    const before = snapshot();
    useApp.getState().appendWorkspace(asLoaded([ds("n1"), ds("n2")]));
    // `workbooks` always shows up too, even with none joining -- the
    // updater spreads a FRESH `[...get().workbooks, ...workbooks]` array
    // unconditionally (workspaceIO.ts's runAppendWorkspace), so its identity
    // changes regardless of content.
    expect(changedSince(before)).toEqual(["datasets", "future", "history", "status", "workbooks"]);
    expect(labels()).toEqual(["append workspace"]);
  });

  // Ordering pin (workspaceIO.ts's own doc: "`recordHistory` runs BEFORE the
  // mutation ... so undo restores the pre-append workbook list for free").
  // Swapping the two calls is invisible to every OTHER spec in this block —
  // they only assert the POST-append state — so this is the one place that
  // would catch `recordHistory` moving after the `set()`.
  it("recordHistory runs BEFORE the mutation — the pushed snapshot is the PRE-append dataset list", () => {
    useApp.setState({ datasets: [ds("d1")], activeId: "d1" });
    useApp.getState().appendWorkspace(asLoaded([ds("n1"), ds("n2")]));
    const snap = useApp.getState().history[0]!.snapshot as unknown as { datasets: Dataset[] };
    expect(snap.datasets.map((d) => d.id)).toEqual(["d1"]);
  });

  it("leaves activeId, plotWindows, and every view-state field completely untouched", () => {
    useApp.setState({
      datasets: [ds("d1")],
      activeId: "d1",
      yKeys: [0],
      xLim: [1, 2],
    });
    const pre = useApp.getState();
    useApp.getState().appendWorkspace(asLoaded([ds("n1")]));
    const s = useApp.getState();
    expect(s.activeId).toBe(pre.activeId);
    expect(s.yKeys).toBe(pre.yKeys);
    expect(s.xLim).toBe(pre.xLim);
    expect(s.plotWindows).toBe(pre.plotWindows);
  });

  it("remaps a colliding dataset id, reports the renamed count in status/toast", () => {
    useApp.setState({ datasets: [ds("d1", "sample")], activeId: "d1" });
    useApp.getState().appendWorkspace(asLoaded([ds("d1", "sample")]));
    const s = useApp.getState();
    expect(s.datasets).toHaveLength(2);
    expect(s.status).toBe("appended 1 dataset (1 renamed)");
    expect(toastTexts()).toEqual(["appended 1 dataset (1 renamed)"]);
  });

  it("joins a referenced workbook and notes the count", () => {
    useApp.setState({ datasets: [ds("d1")], activeId: "d1", workbooks: [] });
    const incoming = asLoaded([{ ...ds("n1"), workbookId: "wb-in" }]);
    incoming.workbooks = [{ id: "wb-in", name: "Imported Book" }];
    useApp.getState().appendWorkspace(incoming);
    const s = useApp.getState();
    expect(s.workbooks).toHaveLength(1);
    expect(s.workbooks[0].name).toBe("Imported Book");
    expect(s.status).toContain("1 workbook landed at Library root");
  });
});
