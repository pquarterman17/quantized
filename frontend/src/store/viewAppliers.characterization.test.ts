// Characterization tests for the BULK VIEW APPLIERS (audit P4.1 —
// "characterization tests first" before a god-module decomposition).
//
// The domain: the three actions that install a WHOLE plot view in one gesture
// from a source description, rather than editing one setting at a time —
// `applyOriginFigure` (an imported Origin graph window), `facetByColumn` (a
// small-multiples partition by a category column) and `breakAtGaps` (a
// paneled x-break arrangement). store/plotViewSettings.ts's header already
// names all three as the "bulk-appliers" it deliberately does NOT own, and
// architecture.test.ts's useApp.ts pin history names them as one 342-line
// candidate cluster; this file is the safety net for actually moving them.
//
// What each spec pins, per action and per BRANCH:
//   1. the EXACT set of top-level store keys the call changes (a whole
//      `getState()` snapshot diffed by identity, after poisoning the fields a
//      branch writes to their own DEFAULT value — otherwise a writer that
//      "resets" a field back to what it already was would be invisible, the
//      exact hole review finding F4 found in the plotViewSettings pins), and
//   2. the observable results — the applied axis/channel/composition values,
//      the undo label pushed (or that none is), and the macro step recorded.
//
// The no-op branches are pinned the same way, with an EMPTY changed set: a
// missing dataset, an empty analysis view, a column with no finite levels, no
// qualifying x-gap. `toast()` writes to the separate `useToasts` store, so it
// never shows up in these diffs; the toast text is asserted directly instead.
//
// Nothing in this file may change when the cluster moves out of
// store/useApp.ts except the module it imports (it imports only `./useApp`,
// so in the event: nothing at all).
//
// Deliberately NOT a duplicate of store/useApp.test.ts's applyOriginFigure /
// facet / break describes: those assert individual decoded fields (legend
// anchors, per-panel geometry, cross-book overlay resolution) and say nothing
// about the complement — which OTHER store fields moved. That complement is
// what a verbatim extraction has to preserve, so it is what this file pins.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { facetPanelsOf, breakPanelsOf, spatialPanelsOf } from "../lib/composition";
import type { Dataset, DataStruct } from "../lib/types";
import { loadOriginApplyLibs } from "./originApplyLibs";
import { useApp } from "./useApp";
import { useToasts } from "./toasts";

vi.mock("../components/overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));

// The Origin-apply half of the figure library is a lazy chunk (bundle
// headroom slice 1). Load it once so every spec below exercises the WARM,
// synchronous path — the cold/deferred path has its own coverage in
// store/originApplyLibs.test.ts.
beforeAll(async () => {
  await loadOriginApplyLibs();
});

// ── fixtures ────────────────────────────────────────────────────────────────

/** Three value channels, three rows — enough for a facet (channel 1 has two
 *  distinct levels), an x-break, and an Origin curve binding. */
const chData = (book: string): DataStruct => ({
  time: [1, 2, 3],
  values: [
    [10, 1, 1000],
    [20, 1, 2000],
    [30, 2, 3000],
  ],
  labels: ["ch0", "ch1", "ch2"],
  units: ["", "", ""],
  metadata: { origin_book: book, x_column_name: "A", origin_column_names: ["B", "C", "D"] },
});

/** Two clusters of x with a wide gap between them — `suggestBreaks` finds one. */
const gappedData: DataStruct = {
  time: [1, 2, 3, 100, 101, 102],
  values: [[1], [2], [3], [4], [5], [6]],
  labels: ["ch0"],
  units: [""],
  metadata: {},
};

const ds = (id: string, data: DataStruct, name = id): Dataset => ({ id, name, data });

const singleLayer = {
  id: "fig-single",
  stem: "XRD",
  datasetId: "d2",
  siblingIds: ["d2"],
  figure: {
    name: "Graph1",
    x_from: 18,
    x_to: 100,
    x_log: false,
    y_from: 1,
    y_to: 1e6,
    y_log: true,
    n_curves: 3,
    annotations: [] as string[],
  },
};

const layer1 = {
  id: "fig-dy-1",
  stem: "XRD",
  datasetId: "d2",
  siblingIds: ["d2"],
  figure: {
    name: "Graph7",
    layer: 1,
    x_from: 0,
    x_to: 10,
    x_log: false,
    y_from: 0,
    y_to: 50,
    y_log: false,
    n_curves: 1,
    annotations: [] as string[],
    curves: [{ book: "Book2", x: "A", y: "B" }],
  },
};
const layer2 = {
  id: "fig-dy-2",
  stem: "XRD",
  datasetId: "d2",
  siblingIds: ["d2"],
  figure: {
    name: "Graph7",
    layer: 2,
    x_from: 0,
    x_to: 10,
    x_log: false,
    y_from: 0,
    y_to: 5000,
    y_log: false,
    y_title: "Counts",
    n_curves: 2,
    annotations: [] as string[],
    curves: [
      { book: "Book2", x: "A", y: "C" },
      { book: "Book2", x: "A", y: "D" },
    ],
  },
};

/** Two same-window layers bound to DIFFERENT datasets — the spatial branch. */
const spatialEntry = (id: string, layer: number, datasetId: string, book: string) => ({
  id,
  stem: "SI",
  datasetId,
  siblingIds: ["p1", "p2"],
  figure: {
    name: "Graph6",
    layer,
    x_from: 0,
    x_to: 10,
    x_log: false,
    y_from: 0,
    y_to: 100 * layer,
    y_log: false,
    n_curves: 1,
    annotations: [] as string[],
    curves: [{ book, x: "A", y: "B" }],
    frame: null,
  },
});

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
const macroCodes = (): string[] => useApp.getState().macroSteps.map((s) => s.code);
const toastTexts = (): string[] => useToasts.getState().toasts.map((t) => t.msg);

/** Run `fn` with the macro recorder armed and return the codes it emitted. */
function withMacro(fn: () => void): string[] {
  useApp.setState({ macroRecording: true, macroSteps: [] });
  fn();
  const codes = macroCodes();
  useApp.setState({ macroRecording: false, macroSteps: [] });
  return codes;
}

/** POISON. Every field the three appliers write to a DEFAULT value gets a
 *  NON-default value first, so "wrote the default" still registers as a diff.
 *  Control inputs (`datasets`, `activeId`, `originFigures`, `xKey`, `yKeys`)
 *  are deliberately NOT poisoned here — each spec owns those, because they
 *  select which branch runs. */
function poison(): void {
  useApp.setState({
    stackMode: false,
    facetKey: 7,
    showGrid: true,
    showAxisBox: false,
    legendStatic: false,
    legendTitle: "stale title",
    legendFrameXY: [0.3, 0.3],
    legendPos: "sw",
    xLim: [-1, -1],
    yLim: [-1, -1],
    xStep: 99,
    yStep: 99,
    xScale: "log",
    yScale: "log",
    xAxisLabel: "STALE X",
    yAxisLabel: "STALE Y",
    y2AxisLabel: "STALE Y2",
    y2Keys: [9],
    y2Lim: [-1, -1],
    y2Scale: "log",
    y2Step: 99,
    seriesStyles: { 9: { color: "#123456" } },
    seriesLabels: { 9: "stale" },
    annotations: [
      { id: "ann-stale", x: 0, y: 0, text: "stale" } as unknown as ReturnType<
        typeof useApp.getState
      >["annotations"][number],
    ],
    regionShades: [],
    panelFit: "page",
    pageSetup: null,
    // `focusTransientReset()` (store/windows.ts) is part of what a rebind
    // does, so poison the cheapest-to-type members of that list too — their
    // own defaults are null/false, which would otherwise make the reset
    // invisible in the diff.
    composition: { kind: "facet", panels: [] } as unknown as ReturnType<
      typeof useApp.getState
    >["composition"],
    qfitBusy: true,
    qfitError: "stale",
    gadgetBusy: true,
    gadgetError: "stale",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useToasts.setState({ toasts: [] });
  useApp.setState({
    datasets: [],
    activeId: null,
    worksheetId: null,
    selectedIds: [],
    librarySelection: null,
    status: "",
    history: [],
    future: [],
    macroSteps: [],
    macroRecording: false,
    originFigures: [],
    originFidelity: [],
    folders: [],
    workbooks: [],
    xKey: null,
    yKeys: null,
    groupKey: null,
    errKeys: {},
    hiddenChannels: [],
    seriesOrder: null,
    fitOverlay: null,
    peakOverlay: null,
    baselineOverlay: null,
  });
  poison();
});

// ── facetByColumn ───────────────────────────────────────────────────────────

describe("facetByColumn — the facet-partition applier", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [ds("d1", chData("Book1")), ds("d2", chData("Book2"))], activeId: "d1" });
  });

  it("an unknown dataset id changes NOTHING (no toast, no history)", () => {
    const before = snapshot();
    useApp.getState().facetByColumn("nope", 1);
    expect(changedSince(before)).toEqual([]);
    expect(toastTexts()).toEqual([]);
  });

  it("an empty analysis view changes NOTHING and toasts", () => {
    useApp.setState({
      datasets: [{ ...ds("d2", chData("Book2")), excludedRows: [0, 1, 2] }],
      activeId: "d1",
    });
    const before = snapshot();
    useApp.getState().facetByColumn("d2", 1);
    expect(changedSince(before)).toEqual([]);
    expect(toastTexts()).toEqual(["no rows to facet (all excluded or filtered out)"]);
  });

  it("a column with no finite levels changes NOTHING and toasts", () => {
    const nan: DataStruct = {
      time: [1, 2],
      values: [[Number.NaN], [Number.NaN]],
      labels: ["ch0"],
      units: [""],
      metadata: {},
    };
    useApp.setState({ datasets: [ds("dn", nan)], activeId: "d1" });
    const before = snapshot();
    useApp.getState().facetByColumn("dn", 0);
    expect(changedSince(before)).toEqual([]);
    expect(toastTexts()).toEqual(["that column has no finite levels to facet on"]);
  });

  it("faceting the ALREADY-active dataset writes exactly this key set", () => {
    useApp.setState({ activeId: "d1" });
    const before = snapshot();
    useApp.getState().facetByColumn("d1", 1);
    expect(changedSince(before)).toEqual([
      "composition",
      "facetKey",
      "future",
      "gadgetBusy",
      "gadgetError",
      "history",
      "plotWindows",
      "qfitBusy",
      "qfitError",
      "selectedIds",
      "stackMode",
    ]);
  });

  it("faceting a DIFFERENT dataset writes exactly this key set (setActive rebind included)", () => {
    useApp.setState({ activeId: "d1" });
    const before = snapshot();
    useApp.getState().facetByColumn("d2", 1);
    expect(changedSince(before)).toEqual([
      "activeId",
      "composition",
      "errKeys",
      "facetKey",
      "future",
      "gadgetBusy",
      "gadgetError",
      "hiddenChannels",
      "history",
      "plotWindows",
      "qfitBusy",
      "qfitError",
      "selectedIds",
      "seriesLabels",
      "seriesStyles",
      "stackMode",
      "xLim",
      "xStep",
      "y2AxisLabel",
      "y2Keys",
      "y2Lim",
      "y2Scale",
      "y2Step",
      "yLim",
      "yStep",
    ]);
  });

  it("installs the facet composition, turns on stackMode and binds facetKey", () => {
    useApp.getState().facetByColumn("d1", 1);
    const s = useApp.getState();
    expect(s.stackMode).toBe(true);
    expect(s.facetKey).toBe(1);
    expect(facetPanelsOf(s.composition)).toHaveLength(2); // levels 1 and 2
    expect(s.activeId).toBe("d1");
  });

  it("pushes exactly ONE undo entry, labeled 'facet by column'", () => {
    useApp.getState().facetByColumn("d2", 1);
    expect(labels()).toEqual(["facet by column"]);
  });

  it("records the macro step with the column's label", () => {
    expect(withMacro(() => useApp.getState().facetByColumn("d1", 1))).toEqual([
      'qz.facetByColumn("d1", 1)',
    ]);
  });
});

// ── breakAtGaps ─────────────────────────────────────────────────────────────

describe("breakAtGaps — the x-break applier", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [ds("g1", gappedData), ds("d2", chData("Book2"))], activeId: "d2" });
  });

  it("an unknown dataset id changes NOTHING", () => {
    const before = snapshot();
    useApp.getState().breakAtGaps("nope");
    expect(changedSince(before)).toEqual([]);
    expect(toastTexts()).toEqual([]);
  });

  it("an empty analysis view changes NOTHING and toasts", () => {
    useApp.setState({ datasets: [{ ...ds("g1", gappedData), excludedRows: [0, 1, 2, 3, 4, 5] }] });
    const before = snapshot();
    useApp.getState().breakAtGaps("g1");
    expect(changedSince(before)).toEqual([]);
    expect(toastTexts()).toEqual(["no rows to break (all excluded or filtered out)"]);
  });

  it("no qualifying gap changes NOTHING and toasts", () => {
    useApp.setState({ datasets: [ds("d2", chData("Book2"))] });
    const before = snapshot();
    useApp.getState().breakAtGaps("d2");
    expect(changedSince(before)).toEqual([]);
    expect(toastTexts()).toEqual(["no large x-gaps found to break at"]);
  });

  it("breaking a DIFFERENT dataset writes exactly this key set", () => {
    const before = snapshot();
    useApp.getState().breakAtGaps("g1");
    expect(changedSince(before)).toEqual([
      "activeId",
      "composition",
      "errKeys",
      "facetKey",
      "gadgetBusy",
      "gadgetError",
      "hiddenChannels",
      "plotWindows",
      "qfitBusy",
      "qfitError",
      "selectedIds",
      "seriesLabels",
      "seriesStyles",
      "stackMode",
      "xLim",
      "xStep",
      "y2AxisLabel",
      "y2Keys",
      "y2Lim",
      "y2Scale",
      "y2Step",
      "yLim",
      "yStep",
    ]);
  });

  it("installs the break composition, turns on stackMode and CLEARS facetKey", () => {
    useApp.getState().breakAtGaps("g1");
    const s = useApp.getState();
    expect(s.stackMode).toBe(true);
    expect(s.facetKey).toBeNull();
    expect(breakPanelsOf(s.composition)).toHaveLength(2);
    expect(s.activeId).toBe("g1");
  });

  it("pushes NO undo entry of its own", () => {
    useApp.getState().breakAtGaps("g1");
    expect(labels()).toEqual([]);
  });

  it("records the macro step", () => {
    expect(withMacro(() => useApp.getState().breakAtGaps("g1"))).toEqual(['qz.breakAtGaps("g1")']);
  });

  // `breakAtGaps("d2")` with no override toasts "no large x-gaps found" (the
  // spec above); an explicit range panels it anyway.
  it("an explicit break list is used INSTEAD of gap detection", () => {
    useApp.setState({ datasets: [ds("d2", chData("Book2"))] });
    useApp.getState().breakAtGaps("d2", [[1.5, 2.5]]);
    expect(breakPanelsOf(useApp.getState().composition)).toHaveLength(2);
    expect(toastTexts()).toEqual([]);
  });
});

// ── applyOriginFigure ───────────────────────────────────────────────────────

describe("applyOriginFigure — single-layer branch", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [ds("d1", chData("Book1"), "XRD:Book1"), ds("d2", chData("Book2"), "XRD:Book2")],
      activeId: "d1",
      originFigures: [singleLayer],
    });
  });

  it("an unknown figure id changes NOTHING", () => {
    const before = snapshot();
    useApp.getState().applyOriginFigure("nope");
    expect(changedSince(before)).toEqual([]);
  });

  it("an entry with no resolved datasetId changes NOTHING", () => {
    useApp.setState({ originFigures: [{ ...singleLayer, datasetId: null }] });
    const before = snapshot();
    useApp.getState().applyOriginFigure("fig-single");
    expect(changedSince(before)).toEqual([]);
  });

  it("applying onto a DIFFERENT dataset writes exactly this key set", () => {
    const before = snapshot();
    useApp.getState().applyOriginFigure("fig-single");
    expect(changedSince(before)).toEqual([
      "activeId",
      "annotations",
      "composition",
      "errKeys",
      "facetKey",
      "gadgetBusy",
      "gadgetError",
      "hiddenChannels",
      "legendFrameXY",
      "legendStatic",
      "legendTitle",
      "plotWindows",
      "qfitBusy",
      "qfitError",
      "regionShades",
      "selectedIds",
      "seriesLabels",
      "seriesStyles",
      "showAxisBox",
      "showGrid",
      "xAxisLabel",
      "xLim",
      "xScale",
      "xStep",
      "y2AxisLabel",
      "y2Keys",
      "y2Lim",
      "y2Scale",
      "y2Step",
      "yAxisLabel",
      "yLim",
      "yStep",
    ]);
  });

  it("applying onto the ALREADY-active dataset writes exactly this key set", () => {
    useApp.setState({ activeId: "d2" });
    const before = snapshot();
    useApp.getState().applyOriginFigure("fig-single");
    expect(changedSince(before)).toEqual([
      "annotations",
      "composition",
      "facetKey",
      "gadgetBusy",
      "gadgetError",
      "legendFrameXY",
      "legendStatic",
      "legendTitle",
      "plotWindows",
      "qfitBusy",
      "qfitError",
      "regionShades",
      "selectedIds",
      "showAxisBox",
      "showGrid",
      "xAxisLabel",
      "xLim",
      "xScale",
      "xStep",
      "yAxisLabel",
      "yLim",
      "yStep",
    ]);
  });

  // The fixture above carries NO decoded curve bindings, so
  // `figureSelectionState(null)` contributes nothing. With bindings it adds
  // the channel-selection keys — pinned separately so a sabotage that drops
  // the selection spread cannot hide behind the binding-less case.
  it("a figure WITH decoded curve bindings additionally writes the channel selection", () => {
    useApp.setState({
      originFigures: [
        {
          ...singleLayer,
          figure: { ...singleLayer.figure, curves: [{ book: "Book2", x: "A", y: "C" }] },
        },
      ],
    });
    const before = snapshot();
    useApp.getState().applyOriginFigure("fig-single");
    expect(changedSince(before)).toEqual([
      "activeId",
      "annotations",
      "composition",
      "errKeys",
      "facetKey",
      "gadgetBusy",
      "gadgetError",
      "hiddenChannels",
      "legendFrameXY",
      "legendStatic",
      "legendTitle",
      "plotWindows",
      "qfitBusy",
      "qfitError",
      "regionShades",
      "selectedIds",
      "seriesLabels",
      "seriesStyles",
      "showAxisBox",
      "showGrid",
      "xAxisLabel",
      "xLim",
      "xScale",
      "xStep",
      "y2AxisLabel",
      "y2Keys",
      "y2Lim",
      "y2Scale",
      "y2Step",
      "yAxisLabel",
      "yKeys",
      "yLim",
      "yStep",
    ]);
    expect(useApp.getState().yKeys).toEqual([1]);
  });

  it("applies the decoded axis snapshot and the Origin look", () => {
    useApp.getState().applyOriginFigure("fig-single");
    const s = useApp.getState();
    expect(s.activeId).toBe("d2");
    expect(s.xLim).toEqual([18, 100]);
    expect(s.yLim).toEqual([1, 1e6]);
    expect(s.xScale).toBe("linear");
    expect(s.yScale).toBe("log");
    expect(s.showAxisBox).toBe(true);
    expect(s.showGrid).toBe(false);
    expect(s.legendStatic).toBe(true);
    expect(s.legendTitle).toBeNull();
    expect(s.facetKey).toBeNull();
    expect(s.annotations).toEqual([]);
    expect(s.regionShades).toEqual([]);
  });

  it("records the macro step and pushes no undo entry of its own", () => {
    expect(withMacro(() => useApp.getState().applyOriginFigure("fig-single"))).toEqual([
      'qz.applyFigure("fig-single")',
    ]);
    expect(labels()).toEqual([]);
  });

  it("newWindow opens and focuses a fresh window before applying", () => {
    const winsBefore = useApp.getState().plotWindows.length;
    useApp.getState().applyOriginFigure("fig-single", { newWindow: true });
    const s = useApp.getState();
    expect(s.plotWindows.length).toBe(winsBefore + 1);
    expect(s.activeId).toBe("d2");
  });
});

describe("applyOriginFigure — double-Y branch (2 layers, same dataset)", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [ds("d2", chData("Book2"), "XRD:Book2")],
      activeId: null,
      originFigures: [layer1, layer2],
    });
  });

  it("writes exactly this key set", () => {
    const before = snapshot();
    useApp.getState().applyOriginFigure("fig-dy-1");
    expect(changedSince(before)).toEqual([
      "activeId",
      "annotations",
      "composition",
      "errKeys",
      "facetKey",
      "gadgetBusy",
      "gadgetError",
      "hiddenChannels",
      "legendFrameXY",
      "legendStatic",
      "legendTitle",
      "plotWindows",
      "qfitBusy",
      "qfitError",
      "regionShades",
      "selectedIds",
      "seriesLabels",
      "seriesStyles",
      "showAxisBox",
      "showGrid",
      "xAxisLabel",
      "xLim",
      "xScale",
      "xStep",
      "y2AxisLabel",
      "y2Keys",
      "y2Lim",
      "y2Scale",
      "y2Step",
      "yAxisLabel",
      "yKeys",
      "yLim",
      "yScale",
      "yStep",
    ]);
  });

  it("combines both layers' channels and gives layer 2 the secondary axis", () => {
    useApp.getState().applyOriginFigure("fig-dy-1");
    const s = useApp.getState();
    expect(s.y2Keys).toEqual([1, 2]);
    expect(s.y2Lim).toEqual([0, 5000]);
    expect(s.y2AxisLabel).toBe("Counts");
    expect(s.yLim).toEqual([0, 50]);
    expect(s.facetKey).toBeNull();
  });
});

describe("applyOriginFigure — spatial multi-panel branch", () => {
  beforeEach(() => {
    useApp.setState({
      datasets: [ds("p1", chData("Book1"), "SI:Book1"), ds("p2", chData("Book2"), "SI:Book2")],
      activeId: null,
      originFigures: [spatialEntry("fig-sp-1", 1, "p1", "Book1"), spatialEntry("fig-sp-2", 2, "p2", "Book2")],
    });
  });

  it("writes exactly this key set", () => {
    const before = snapshot();
    useApp.getState().applyOriginFigure("fig-sp-1");
    expect(changedSince(before)).toEqual([
      "activeId",
      "composition",
      "errKeys",
      "facetKey",
      "gadgetBusy",
      "gadgetError",
      "hiddenChannels",
      "legendStatic",
      "panelFit",
      "plotWindows",
      "qfitBusy",
      "qfitError",
      "regionShades",
      "selectedIds",
      "seriesLabels",
      "seriesStyles",
      "showAxisBox",
      "showGrid",
      "stackMode",
      "xLim",
      "xStep",
      "y2AxisLabel",
      "y2Keys",
      "y2Lim",
      "y2Scale",
      "y2Step",
      "yLim",
      "yStep",
    ]);
  });

  it("arranges one panel per layer, boxed, with the singleton shade list cleared", () => {
    useApp.getState().applyOriginFigure("fig-sp-1");
    const s = useApp.getState();
    expect(spatialPanelsOf(s.composition)).toHaveLength(2);
    expect(s.stackMode).toBe(true);
    expect(s.showAxisBox).toBe(true);
    expect(s.regionShades).toEqual([]);
    expect(s.facetKey).toBeNull();
  });
});
