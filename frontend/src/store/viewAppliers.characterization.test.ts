// Characterization tests for the BULK VIEW APPLIERS (audit P4.1 —
// "characterization tests first" before a god-module decomposition).
//
// The domain: the three actions that install a WHOLE plot view in one gesture
// from a source description, rather than editing one setting at a time —
// `applyOriginFigure` (an imported Origin graph window), `facetByColumn` (a
// small-multiples partition by a category column) and `breakAtGaps` (a
// paneled x-break arrangement). store/plotViewSettings.ts's header already
// names all three as the "bulk-appliers" it deliberately does NOT own, and
// architecture.test.ts's useApp.ts pin history names them as one 336-line
// candidate cluster (base useApp.ts 985-1320; measured off the removal
// hunk, not estimated); this file is the safety net for actually moving them.
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

/** Curves spanning TWO books (Book1 + Book2) — the cross-book overlay
 *  branch. Both curves bind letter "B" (channel 0, "ch0") against x-letter
 *  "A" (the designated time column), one per book, so `buildOverlayDataset`
 *  resolves 2 distinct (dataset, xChannel) blocks — the ≥2-block minimum
 *  `assembleOverlay` requires to treat this as a real overlay rather than a
 *  plain single-book apply. */
const overlayEntry = {
  id: "fig-ov",
  stem: "XRD",
  datasetId: "d1",
  siblingIds: ["d1", "d2"],
  figure: {
    name: "GraphOV",
    x_from: 0,
    x_to: 10,
    x_log: false,
    y_from: 0,
    y_to: 100,
    y_log: false,
    n_curves: 2,
    annotations: [] as string[],
    curves: [
      { book: "Book1", x: "A", y: "B" },
      { book: "Book2", x: "A", y: "B" },
    ],
  },
};

/** A materialized overlay dataset already sitting in the library, stamped
 *  exactly as `originOverlayDataset` stamps one (`origin_overlay_source` ties
 *  it back to `overlayEntry.id`) — the fixture for the "re-apply onto the
 *  ALREADY-active overlay" branch below. Carries no corrections/formulas/
 *  filter/excluded-rows/fitSpec, so `confirmOriginReapplyDiscard` finds
 *  nothing to discard and proceeds synchronously (same as a first apply). */
const existingOverlay = ds(
  "d-ov",
  {
    time: [1, 2],
    values: [
      [10, 1000],
      [20, 2000],
    ],
    labels: ["Book1: ch0", "Book2: ch0"],
    units: ["", ""],
    metadata: {
      origin_overlay: true,
      origin_overlay_source: "fig-ov",
      origin_overlay_version: 2,
      origin_column_names: ["c0", "c1"],
      x_column_name: "A",
    },
  },
  "XRD (overlay)",
);

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
// F5: the human-readable half of `recordMacro(label, code)` — `macroCodes`
// only reads `.code`, so a reworded `label` argument was invisible to every
// spec in this file until this helper existed.
const macroLabels = (): string[] => useApp.getState().macroSteps.map((s) => s.label);
const toastTexts = (): string[] => useToasts.getState().toasts.map((t) => t.msg);

/** POISON. Every field the three appliers write to a DEFAULT value gets a
 *  NON-default value first, so "wrote the default" still registers as a diff.
 *  Control inputs (`datasets`, `activeId`, `originFigures`, `xKey`, `yKeys`)
 *  are deliberately NOT poisoned here — each spec owns those, because they
 *  select which branch runs.
 *
 *  Audit (review-3 F3): every entry below was checked against two things —
 *  its OWN field default (useApp.ts's initial state) and what the three
 *  appliers actually WRITE it to. The contract only needs the poison value to
 *  differ from the WRITTEN value, which is why a few entries below equal
 *  their own default without being a hole:
 *    - `stackMode: false` and `legendStatic: false` equal their own defaults,
 *      but no branch in this file's domain ever writes either back to
 *      false/default — both are write-only-true fields here — so a poison
 *      equal to the default cannot hide a "wrote the default" diff.
 *    - `showGrid: true` equals its own default (`_initialPrefs.defaultGrid`),
 *      same reasoning: `ORIGIN_FIGURE_AXIS` always writes `showGrid: false`,
 *      never true.
 *    - `regionShades: []` equals its own default BY VALUE, but the diff below
 *      is an IDENTITY compare (`after[k] !== before[k]`) — a fresh `[]`
 *      literal is a new array reference, so it still registers. Safe.
 *    - `pageSetup: null` was the ONE genuine hole: `null` IS the field's own
 *      default, AND the spatial branch's own write
 *      (`pageSetupFromDecoded(family[0].figure.page ?? null)`) evaluates to
 *      `null` for every fixture here (no figure decodes a `page`) — so the
 *      "wrote the default" case this helper exists to catch was exactly the
 *      one case it didn't catch. Fixed below to a non-default `PageSetup`. */
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
    regionShades: [], // safe by IDENTITY (a fresh [] is a new reference) despite equaling the default by value — see the audit comment above
    panelFit: "page",
    // F3 fix: `null` is pageSetup's own default AND what the spatial branch
    // actually writes for every fixture here (undecoded page) — poisoning to
    // `null` made that write invisible. A non-default PageSetup makes the
    // spatial branch's write (back to null) register.
    pageSetup: {
      width: 42,
      height: 42,
      unit: "in",
      margins: { left: 1, right: 1, top: 1, bottom: 1 },
      aspectDerived: false,
    } as unknown as ReturnType<typeof useApp.getState>["pageSetup"],
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
    // F1 audit residual: `plotTitle` is not written by any CORRECT branch in
    // this file's domain, but the overlay branch's own `set({...})` is where
    // a stray write would land (S1's sabotage), and without a poison entry
    // here the field is never reset between tests at all (this file's outer
    // beforeEach doesn't touch it either) — a sabotage-written "SAB" would
    // leak into every LATER test's "before" snapshot and silently mask
    // itself. Non-default so a write-to-default would register too.
    plotTitle: "STALE TITLE",
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
    useApp.setState({ macroRecording: true, macroSteps: [] });
    useApp.getState().facetByColumn("d1", 1);
    expect(macroCodes()).toEqual(['qz.facetByColumn("d1", 1)']);
    // F5: `recordMacro`'s human-readable LABEL argument (as opposed to its
    // `code` line) was never asserted anywhere in this file — a reworded
    // label survived the whole suite (review-3 F5).
    expect(macroLabels()).toEqual(["Facet by ch1"]);
    useApp.setState({ macroRecording: false, macroSteps: [] });
  });

  // F6: `facetByColumn` pushes its OWN undo entry (labeled "facet by
  // column") BEFORE calling `setActive`, then drops `setActive`'s
  // near-duplicate "create window" entry when the focused window is pinned
  // with no unpinned candidate (`retargetPassiveRebind` falls back to
  // `createWindow`, whose `recordHistory("create window")` snapshots the
  // SAME pre-gesture state ours does). Read viewAppliers.ts:373-385's L3
  // comment before touching this: the invariant is (1) the pushed snapshot
  // is the state BEFORE the rebind (so Ctrl+Z restores the pre-gesture
  // `activeId`), and (2) exactly ONE entry survives, correctly labeled
  // "facet by column" — not "create window". Swapping the `recordHistory`/
  // `setActive` call order flips which entry the L3 dedup keeps (it always
  // drops the LATER of the two), silently mislabeling the undo entry and
  // moving its snapshot to the POST-rebind state.
  it("pins the setActive -> recordHistory order: the undo entry snapshots the PRE-rebind state and keeps our own label, even when setActive's own retarget pushes a near-duplicate", () => {
    const focusedId = useApp.getState().focusedWindowId;
    useApp.setState({
      // No other unpinned plot window exists, so `retargetPassiveRebind`
      // falls through to `createWindow` (its own history push) instead of
      // just refocusing an existing one.
      plotWindows: useApp.getState().plotWindows.map((w) =>
        w.id === focusedId ? { ...w, pinned: true } : w,
      ),
    });
    useApp.getState().facetByColumn("d2", 1);
    expect(labels()).toEqual(["facet by column"]);
    expect(useApp.getState().history[0]?.snapshot.activeId).toBe("d1");
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

  // F4: `facetByColumn` gets both an ALREADY-active and a DIFFERENT-dataset
  // key-set spec because its `facetKey: null` clear (F4.4 review L1) only
  // matters in the ALREADY-active case — `setActive`'s own genuine-switch
  // reset already nulls `facetKey` on a real dataset change, masking a
  // dropped explicit clear there. `breakAtGaps` carries the identical
  // F4.4-L1 clear and comment but, before this spec, had only the
  // DIFFERENT-dataset case pinned — the one case that CANNOT observe the
  // clear being dropped.
  it("breaking the ALREADY-active dataset writes exactly this key set", () => {
    useApp.setState({ activeId: "g1" });
    const before = snapshot();
    useApp.getState().breakAtGaps("g1");
    expect(changedSince(before)).toEqual([
      "composition",
      "facetKey",
      "gadgetBusy",
      "gadgetError",
      "plotWindows",
      "qfitBusy",
      "qfitError",
      "selectedIds",
      "stackMode",
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
    useApp.setState({ macroRecording: true, macroSteps: [] });
    useApp.getState().breakAtGaps("g1");
    expect(macroCodes()).toEqual(['qz.breakAtGaps("g1")']);
    // F5: the label half of recordMacro (`breakAtGaps` uses the literal
    // "Break x-axis at gaps", no interpolation) was previously unpinned.
    expect(macroLabels()).toEqual(["Break x-axis at gaps"]);
    useApp.setState({ macroRecording: false, macroSteps: [] });
  });

  // `breakAtGaps("d2")` with no override toasts "no large x-gaps found" (the
  // spec above); an explicit range panels it anyway.
  it("an explicit break list is used INSTEAD of gap detection", () => {
    useApp.setState({ datasets: [ds("d2", chData("Book2"))] });
    useApp.getState().breakAtGaps("d2", [[1.5, 2.5]]);
    expect(breakPanelsOf(useApp.getState().composition)).toHaveLength(2);
    expect(toastTexts()).toEqual([]);
  });

  // F9: a FIFTH no-op branch exists beyond the four enumerated in this
  // file's header (missing dataset, empty analysis view, no finite levels,
  // no qualifying x-gap) — an explicit break list that IS non-empty (so the
  // "no large x-gaps found" toast above never fires) but whose
  // `breakCompositionFromData` result has fewer than 2 surviving panels
  // (`compositionPanelCount(composition) < 2`, viewAppliers.ts:426-429).
  // Here the break `[0, 0.5]` sits entirely below every row's x, so the
  // segment before it is empty and only one panel survives.
  it("an explicit break that leaves fewer than 2 panels changes NOTHING and toasts", () => {
    useApp.setState({ datasets: [ds("d2", chData("Book2"))] });
    const before = snapshot();
    useApp.getState().breakAtGaps("d2", [[0, 0.5]]);
    expect(changedSince(before)).toEqual([]);
    expect(toastTexts()).toEqual(["not enough data on both sides of a break to panel"]);
  });
});

// ── applyOriginFigure ───────────────────────────────────────────────────────

// F1: the cross-book OVERLAY branch (viewAppliers.ts:132-204) previously had
// NO changed-key spec at all, despite this file's own header and three other
// records claiming coverage "per action AND per branch" across all FOUR
// `applyOriginFigure` branches. It is the branch that writes the MOST keys
// (~18 in one `set({...})` plus `datasets` plus the `setActive` rebind), and
// two mutations of exactly the shape this file exists to catch survived the
// entire suite before these specs: an extra carried-along `plotTitle` write,
// and a dropped `facetKey: null` clear (the F4.4 review L1 protection).
//
// Two scenarios, like the other branches: a NEW overlay (no prior
// materialized dataset — a genuine dataset switch, so `setActive`'s own
// `datasetViewDefaults` ALSO resets `facetKey` on a real switch) and a
// RE-APPLY onto the dataset that is ALREADY active (no genuine switch, so
// `datasetViewDefaults` never fires — the explicit `facetKey: null` in the
// branch's own `set({...})` is the ONLY thing that clears it). The dropped-
// clear sabotage is only observable in the second scenario; the extra-write
// sabotage is observable in both (both call the same shared `set({...})`).
describe("applyOriginFigure — cross-book overlay branch", () => {
  describe("building a NEW overlay (a genuine dataset switch)", () => {
    beforeEach(() => {
      useApp.setState({
        datasets: [ds("d1", chData("Book1"), "XRD:Book1"), ds("d2", chData("Book2"), "XRD:Book2")],
        activeId: null,
        originFigures: [overlayEntry],
      });
    });

    it("writes exactly this key set", () => {
      const before = snapshot();
      useApp.getState().applyOriginFigure("fig-ov");
      expect(changedSince(before)).toEqual([
        "activeId",
        "annotations",
        "composition",
        "datasets",
        "errKeys",
        "facetKey",
        "future",
        "gadgetBusy",
        "gadgetError",
        "hiddenChannels",
        "history",
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

    it("builds the overlay dataset (segment-concatenated, one column per curve), activates it, applies the decoded axis snapshot, and records the macro step", () => {
      useApp.getState().applyOriginFigure("fig-ov");
      const s = useApp.getState();
      const overlayDs = s.datasets.find((d) => d.id === s.activeId);
      expect(overlayDs?.data.labels).toEqual(["Book1: ch0", "Book2: ch0"]);
      expect(s.yKeys).toEqual([0, 1]);
      expect(s.xLim).toEqual([0, 10]);
      expect(s.yLim).toEqual([0, 100]);
      expect(s.xScale).toBe("linear");
      expect(s.yScale).toBe("linear");
      expect(s.showAxisBox).toBe(true);
      expect(s.showGrid).toBe(false);
      expect(s.facetKey).toBeNull();
      // The reviewed sabotage this spec's key-set sibling catches: this
      // branch must NOT carry along a `plotTitle` write, so the poisoned
      // value survives untouched.
      expect(s.plotTitle).toBe("STALE TITLE");
      expect(toastTexts()).toEqual(["built overlay — 2 curves"]);
    });
  });

  describe("re-applying onto the ALREADY-active overlay dataset (no genuine switch)", () => {
    beforeEach(() => {
      useApp.setState({
        datasets: [
          ds("d1", chData("Book1"), "XRD:Book1"),
          ds("d2", chData("Book2"), "XRD:Book2"),
          existingOverlay,
        ],
        activeId: "d-ov",
        originFigures: [overlayEntry],
      });
    });

    // F1 / S6: with the target dataset ALREADY active, `setActive`'s own
    // genuine-switch reset (`datasetViewDefaults`) never fires — `facetKey`
    // showing up here depends ENTIRELY on the branch's own explicit
    // `facetKey: null` write. Dropping that write (as the reviewed sabotage
    // did) leaves `facetKey` at its poisoned value and this key set fails.
    it("writes exactly this key set", () => {
      const before = snapshot();
      useApp.getState().applyOriginFigure("fig-ov");
      expect(changedSince(before)).toEqual([
        "annotations",
        "composition",
        "datasets",
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
        "seriesLabels",
        "seriesStyles",
        "showAxisBox",
        "showGrid",
        "xAxisLabel",
        "xLim",
        "xScale",
        "xStep",
        "yAxisLabel",
        "yKeys",
        "yLim",
        "yScale",
        "yStep",
      ]);
    });

    it("rebuilds the overlay in place (no add-dataset toast, no undo entry) and still clears facetKey", () => {
      useApp.getState().applyOriginFigure("fig-ov");
      const s = useApp.getState();
      expect(s.activeId).toBe("d-ov");
      expect(s.datasets).toHaveLength(3);
      expect(s.facetKey).toBeNull();
      expect(toastTexts()).toEqual([]);
      expect(labels()).toEqual([]);
    });
  });
});

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
    useApp.setState({ macroRecording: true, macroSteps: [] });
    useApp.getState().applyOriginFigure("fig-single");
    expect(macroCodes()).toEqual(['qz.applyFigure("fig-single")']);
    // F5: the label half of recordMacro (`Apply figure "<name>"`) was
    // previously unpinned across all three applyOriginFigure branches.
    expect(macroLabels()).toEqual(['Apply figure "Graph1"']);
    useApp.setState({ macroRecording: false, macroSteps: [] });
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
      // F3: the spatial branch's `pageSetup: pageSetupFromDecoded(...)` write
      // resolves to `null` for this fixture (no decoded page) — the SAME
      // value as `pageSetup`'s own default, which is exactly why `poison()`
      // has to poison it non-default (see that function's audit comment).
      "pageSetup",
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
