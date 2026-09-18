// Characterization tests for the PlotView-settings writers (audit P4.1 —
// "characterization tests first" before a god-module decomposition).
//
// These pin the CURRENT, pre-extraction behaviour of every action that writes
// singleton PlotView state through the REAL composed store: which fields each
// one writes, which undo label it pushes (or that it pushes none), whether it
// records a macro step, and one edge case per action. They are the safety net
// for moving this cluster out of store/useApp.ts into store/plotViewSettings.ts
// — nothing in this file may change with that move except import paths (it
// imports only `./useApp`, so in the event nothing changed at all).
//
// Deliberately NOT a duplicate of store/useApp.test.ts: that file covers the
// channel-indexed RESET rules (a dataset switch clearing seriesStyles/errKeys/
// hiddenChannels/limits) which live in `setActive`/`addDataset`, not in these
// writers. This file covers the writers themselves, exhaustively.
//
// Ids: `addRefLine`/`addAnnotation` mint ids from module-level counters that
// keep climbing across the whole test file, so every assertion here checks the
// PREFIX and uniqueness, never a literal `ref-1`.

import { beforeEach, describe, expect, it } from "vitest";

import type { PageSetup } from "../lib/pagesetup";
import type { PlotWindow } from "../lib/plotview";
import type { Dataset, DataStruct } from "../lib/types";
import { useApp } from "./useApp";

const data: DataStruct = {
  time: [1, 2, 3],
  values: [
    [10, 100, 1000],
    [20, 200, 2000],
    [30, 300, 3000],
  ],
  labels: ["a", "b", "c"],
  units: ["", "", ""],
  metadata: {},
};

const ds = (id: string): Dataset => ({ id, name: id, data });

const PAGE: PageSetup = {
  width: 6,
  height: 4,
  unit: "in",
  margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 },
  aspectDerived: false,
};

/** Every field these writers touch, reset to the store's own initial value so a
 *  test never inherits a neighbour's state. */
function resetView(): void {
  useApp.setState({
    datasets: [],
    activeId: null,
    status: "",
    history: [],
    future: [],
    macroSteps: [],
    macroRecording: false,
    pipelineRunning: false,
    projectDirty: false,
    plotWindows: [],
    focusedWindowId: null,
    yScale: "linear",
    xScale: "linear",
    showGrid: false,
    showLegend: true,
    legendPos: "ne",
    legendStatic: false,
    plotTemplate: "screen",
    showAxisBox: true,
    stackMode: false,
    panelFit: "frames",
    pageSetup: null,
    composition: null,
    facetKey: null,
    insetMode: false,
    polarMode: false,
    statMode: false,
    xLim: null,
    yLim: null,
    xStep: null,
    yStep: null,
    y2Scale: null,
    y2Lim: null,
    y2Step: null,
    y2Keys: null,
    y2AxisLabel: "",
    xFmt: { mode: "auto", digits: 2 },
    yFmt: { mode: "auto", digits: 2 },
    y2Fmt: null,
    plotTitle: "",
    xAxisLabel: "",
    yAxisLabel: "",
    xKey: null,
    yKeys: null,
    groupKey: null,
    refLines: [],
    annotations: [],
    seriesStyles: {},
    seriesLabels: {},
    errKeys: {},
    seriesOrder: null,
    hiddenChannels: [],
    waterfall: 0,
  });
}

beforeEach(resetView);

const labels = (): string[] => useApp.getState().history.map((h) => h.label);
const macroCodes = (): string[] => useApp.getState().macroSteps.map((s) => s.code);

/** Run `fn` with the macro recorder armed, and return the codes it emitted. */
function withMacro(fn: () => void): string[] {
  useApp.setState({ macroRecording: true, macroSteps: [] });
  fn();
  const codes = macroCodes();
  useApp.setState({ macroRecording: false, macroSteps: [] });
  return codes;
}

// ── The uniform writers: one field, one undo label ──────────────────────────
// Each row is [name, invoke, field, expected value]. Pinned as a table because
// the behaviour genuinely IS uniform; anything that is not uniform (extra
// fields cleared, no history entry, a macro step) gets its own spec below.
const SIMPLE: [string, () => void, keyof ReturnType<typeof useApp.getState>, unknown, string][] = [
  ["setYScale", () => useApp.getState().setYScale("log"), "yScale", "log", "change Y scale"],
  ["setXScale", () => useApp.getState().setXScale("log"), "xScale", "log", "change X scale"],
  ["setShowGrid", () => useApp.getState().setShowGrid(true), "showGrid", true, "toggle grid"],
  ["setShowLegend", () => useApp.getState().setShowLegend(false), "showLegend", false, "toggle legend"],
  ["setLegendPos", () => useApp.getState().setLegendPos("sw"), "legendPos", "sw", "move legend"],
  ["setLegendStatic", () => useApp.getState().setLegendStatic(true), "legendStatic", true, "change legend mode"],
  ["setPlotTemplate", () => useApp.getState().setPlotTemplate("print"), "plotTemplate", "print", "apply plot template"],
  ["setShowAxisBox", () => useApp.getState().setShowAxisBox(false), "showAxisBox", false, "toggle axis box"],
  ["setPanelFit", () => useApp.getState().setPanelFit("window"), "panelFit", "window", "change panel fit"],
  ["setInsetMode", () => useApp.getState().setInsetMode(true), "insetMode", true, "toggle inset"],
  ["setPolarMode", () => useApp.getState().setPolarMode(true), "polarMode", true, "toggle polar plot"],
  ["setStatMode", () => useApp.getState().setStatMode(true), "statMode", true, "toggle statistics plot"],
  ["setY2Scale", () => useApp.getState().setY2Scale("log"), "y2Scale", "log", "change Y2 scale"],
  ["setXFmt", () => useApp.getState().setXFmt({ mode: "sci", digits: 3 }), "xFmt", { mode: "sci", digits: 3 }, "format X axis"],
  ["setYFmt", () => useApp.getState().setYFmt({ mode: "sci", digits: 3 }), "yFmt", { mode: "sci", digits: 3 }, "format Y axis"],
  ["setY2Fmt", () => useApp.getState().setY2Fmt({ mode: "sci", digits: 3 }), "y2Fmt", { mode: "sci", digits: 3 }, "format Y2 axis"],
  ["setXAxisLabel", () => useApp.getState().setXAxisLabel("q"), "xAxisLabel", "q", "edit X axis title"],
  ["setYAxisLabel", () => useApp.getState().setYAxisLabel("I"), "yAxisLabel", "I", "edit Y axis title"],
  ["setY2AxisLabel", () => useApp.getState().setY2AxisLabel("T"), "y2AxisLabel", "T", "edit Y2 axis title"],
  ["setSeriesOrder", () => useApp.getState().setSeriesOrder([2, 0, 1]), "seriesOrder", [2, 0, 1], "reorder curves"],
];

describe("plot-view settings — the uniform one-field writers", () => {
  it.each(SIMPLE)("%s writes its field and records one undo entry", (_name, invoke, field, expected, label) => {
    invoke();
    expect(useApp.getState()[field]).toEqual(expected);
    expect(labels()).toEqual([label]);
  });

  it.each(SIMPLE)("%s leaves the project's dirty marker alone", (_name, invoke) => {
    invoke();
    expect(useApp.getState().projectDirty).toBe(false);
  });

  // Review F4: the specs above pin the field WRITTEN, but nothing asserted the
  // complement — that no OTHER top-level store field moved. Sabotage that adds
  // an extra `set(...)` field (e.g. setPolarMode also clearing stackMode/
  // composition) passed every spec above. Diff the whole getState() snapshot
  // instead of reading one key.
  //
  // Poison stackMode/composition/facetKey (F6: the fields a legitimate
  // bulk-writer like facetByColumn/breakAtGaps clears) to NON-default values
  // first. Without this, a sabotage that "clears" one of them back to its own
  // default (stackMode: false, composition: null — resetView's own starting
  // values) produces byte-identical state and no diff would ever see it.
  it.each(SIMPLE)("%s writes ONLY its own field (plus history/future bookkeeping)", (_name, invoke, field) => {
    useApp.setState({
      stackMode: true,
      composition: { kind: "facet" } as unknown as ReturnType<typeof useApp.getState>["composition"],
      facetKey: 7,
    });
    const before = { ...useApp.getState() } as Record<string, unknown>;
    invoke();
    const after = useApp.getState() as unknown as Record<string, unknown>;
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    expect(changed.sort()).toEqual([field, "future", "history"].sort());
  });

  it.each(SIMPLE)("%s records no macro step while the recorder is idle", (_name, invoke) => {
    invoke();
    expect(useApp.getState().macroSteps).toEqual([]);
  });

  it("the undo snapshot is the PRE-mutation value (recordHistory runs before set)", () => {
    useApp.getState().setYScale("log");
    expect(useApp.getState().history[0].snapshot.view.yScale).toBe("linear");
  });

  it.each(SIMPLE)("%s pushes an entry per call — repeats are not coalesced", (_name, invoke, _f, _e, label) => {
    invoke();
    invoke();
    expect(labels()).toEqual([label, label]);
  });
});

// ── Axis limits: the one pair that does NOT record history ─────────────────
describe("plot-view settings — axis limits (no undo entry, paired step cleared)", () => {
  it("setXLim writes xLim, clears the decoded xStep, and records NOTHING", () => {
    useApp.setState({ xStep: 5 });
    useApp.getState().setXLim([0, 10]);
    expect(useApp.getState().xLim).toEqual([0, 10]);
    expect(useApp.getState().xStep).toBeNull();
    expect(labels()).toEqual([]);
  });

  it("setYLim writes yLim, clears the decoded yStep, and records NOTHING", () => {
    useApp.setState({ yStep: 5 });
    useApp.getState().setYLim([0, 10]);
    expect(useApp.getState().yLim).toEqual([0, 10]);
    expect(useApp.getState().yStep).toBeNull();
    expect(labels()).toEqual([]);
  });

  it("clearing a limit back to null (autoscale) still clears the paired step", () => {
    useApp.setState({ xLim: [0, 10], xStep: 5, yLim: [0, 10], yStep: 5 });
    useApp.getState().setXLim(null);
    useApp.getState().setYLim(null);
    expect(useApp.getState()).toMatchObject({ xLim: null, xStep: null, yLim: null, yStep: null });
  });

  it("setY2Lim DOES record history, and clears y2Step alongside", () => {
    useApp.setState({ y2Step: 5 });
    useApp.getState().setY2Lim([1, 2]);
    expect(useApp.getState().y2Lim).toEqual([1, 2]);
    expect(useApp.getState().y2Step).toBeNull();
    expect(labels()).toEqual(["change Y2 limits"]);
  });

  it("setY2Scale leaves y2Step alone (only a RANGE invalidates the decoded step)", () => {
    useApp.setState({ y2Step: 5 });
    useApp.getState().setY2Scale("log");
    expect(useApp.getState().y2Step).toBe(5);
  });
});

// ── Layout modes ───────────────────────────────────────────────────────────
describe("plot-view settings — stack mode and panel fit", () => {
  it("setStackMode(true) drops a stale spatial/facet arrangement in the same write", () => {
    useApp.setState({ composition: { kind: "facet", panels: [] }, facetKey: 2 });
    useApp.getState().setStackMode(true);
    expect(useApp.getState()).toMatchObject({ stackMode: true, composition: null, facetKey: null });
    expect(labels()).toEqual(["change plot layout"]);
  });

  it("setStackMode(false) clears composition/facetKey too — BOTH directions", () => {
    useApp.setState({ stackMode: true, composition: { kind: "facet", panels: [] }, facetKey: 2 });
    useApp.getState().setStackMode(false);
    expect(useApp.getState()).toMatchObject({ stackMode: false, composition: null, facetKey: null });
  });

  it("setStackMode returns the SAME plotWindows array when no focused window holds an x break", () => {
    const windows = [] as PlotWindow[];
    useApp.setState({ plotWindows: windows });
    useApp.getState().setStackMode(true);
    expect(useApp.getState().plotWindows).toBe(windows);
  });

  it("cyclePanelFit is a two-way frames<->window toggle when there is no page setup", () => {
    useApp.getState().cyclePanelFit();
    expect(useApp.getState().panelFit).toBe("window");
    useApp.getState().cyclePanelFit();
    expect(useApp.getState().panelFit).toBe("frames");
    expect(labels()).toEqual(["change panel fit", "change panel fit"]);
  });

  it("cyclePanelFit offers `page` once a page setup exists", () => {
    useApp.setState({
      panelFit: "window",
      pageSetup: PAGE,
    });
    useApp.getState().cyclePanelFit();
    expect(useApp.getState().panelFit).toBe("page");
  });

  it("setPageSetup stores and clears the page model under one undo label", () => {
    useApp.getState().setPageSetup(PAGE);
    expect(useApp.getState().pageSetup).toEqual(PAGE);
    useApp.getState().setPageSetup(null);
    expect(useApp.getState().pageSetup).toBeNull();
    expect(labels()).toEqual(["change page setup", "change page setup"]);
  });
});

// ── Titles and channel keys (the macro-recorded writers) ───────────────────
describe("plot-view settings — titles and channel keys", () => {
  it("setPlotTitle writes the title and records a macro step", () => {
    expect(withMacro(() => useApp.getState().setPlotTitle("M vs H"))).toEqual([
      'qz.setPlotTitle("M vs H")',
    ]);
    expect(useApp.getState().plotTitle).toBe("M vs H");
    expect(labels()).toEqual(["edit plot title"]);
  });

  it("an empty title still writes, and its macro label says (none)", () => {
    useApp.setState({ plotTitle: "old", macroRecording: true });
    useApp.getState().setPlotTitle("");
    expect(useApp.getState().plotTitle).toBe("");
    expect(useApp.getState().macroSteps[0].label).toBe("Title → (none)");
  });

  it("setXKey / setYKeys / setGroupKey write their field and record a macro step", () => {
    expect(
      withMacro(() => {
        useApp.getState().setXKey(1);
        useApp.getState().setYKeys([0, 2]);
        useApp.getState().setGroupKey(2);
      }),
    ).toEqual(["qz.setXKey(1)", "qz.setYKeys([0, 2])", "qz.setGroupKey(2)"]);
    expect(useApp.getState()).toMatchObject({ xKey: 1, yKeys: [0, 2], groupKey: 2 });
    expect(labels()).toEqual(["change X channel", "change Y channels", "change group"]);
  });

  it("the null forms read back as time / all / none in the macro label", () => {
    useApp.setState({ macroRecording: true });
    useApp.getState().setXKey(null);
    useApp.getState().setYKeys(null);
    useApp.getState().setGroupKey(null);
    expect(useApp.getState().macroSteps.map((s) => s.label)).toEqual([
      "X axis → channel time",
      "Y channels → all",
      "Group by channel none",
    ]);
  });

  it("setY2Keys(null) tears the whole secondary axis down with it", () => {
    useApp.setState({
      y2Keys: [2],
      y2Lim: [0, 1],
      y2Scale: "log",
      y2Step: 0.5,
      y2AxisLabel: "T",
    });
    useApp.getState().setY2Keys(null);
    expect(useApp.getState()).toMatchObject({
      y2Keys: null,
      y2Lim: null,
      y2Scale: null,
      y2Step: null,
      y2AxisLabel: "",
    });
    expect(labels()).toEqual(["change Y2 channels"]);
  });

  it("setY2Keys with channels LEAVES the secondary axis state intact", () => {
    useApp.setState({ y2Lim: [0, 1], y2Scale: "log", y2Step: 0.5, y2AxisLabel: "T" });
    useApp.getState().setY2Keys([2]);
    expect(useApp.getState()).toMatchObject({
      y2Keys: [2],
      y2Lim: [0, 1],
      y2Scale: "log",
      y2Step: 0.5,
      y2AxisLabel: "T",
    });
  });
});

// ── Reference lines and annotations ────────────────────────────────────────
describe("plot-view settings — reference lines", () => {
  it("addRefLine appends with a fresh ref- id per call", () => {
    useApp.getState().addRefLine("x", 1);
    useApp.getState().addRefLine("y", 2);
    const [a, b] = useApp.getState().refLines;
    expect(a).toMatchObject({ axis: "x", value: 1 });
    expect(b).toMatchObject({ axis: "y", value: 2 });
    expect(a.id).toMatch(/^ref-\d+$/);
    expect(b.id).not.toBe(a.id);
    expect(labels()).toEqual(["add reference line", "add reference line"]);
  });

  it("removeRefLine drops exactly the named line", () => {
    useApp.getState().addRefLine("x", 1);
    useApp.getState().addRefLine("y", 2);
    const keep = useApp.getState().refLines[1].id;
    useApp.getState().removeRefLine(useApp.getState().refLines[0].id);
    expect(useApp.getState().refLines.map((r) => r.id)).toEqual([keep]);
  });

  it("updateRefLine moves one line by id", () => {
    useApp.getState().addRefLine("x", 1);
    const id = useApp.getState().refLines[0].id;
    useApp.getState().updateRefLine(id, 42);
    expect(useApp.getState().refLines[0].value).toBe(42);
  });

  it("an unknown id changes nothing — but the undo entry is still pushed", () => {
    useApp.getState().addRefLine("x", 1);
    const before = useApp.getState().refLines;
    useApp.getState().updateRefLine("ref-nope", 99);
    useApp.getState().removeRefLine("ref-nope");
    expect(useApp.getState().refLines).toEqual(before);
    expect(labels()).toEqual([
      "add reference line",
      "move reference line",
      "delete reference line",
    ]);
  });
});

describe("plot-view settings — annotations", () => {
  it("addAnnotation returns the new id and pins the text at data coordinates", () => {
    const id = useApp.getState().addAnnotation(1, 2, "hi");
    expect(id).toMatch(/^ann-\d+$/);
    expect(useApp.getState().annotations).toEqual([{ id, x: 1, y: 2, text: "hi" }]);
    expect(labels()).toEqual(["add annotation"]);
  });

  it("a STALE history token is ignored — the add records its own entry", () => {
    // `withHistoryBatch` hands out the only live token; anything else (a token
    // whose batch already ended) is treated exactly like no token at all.
    useApp.getState().addAnnotation(1, 2, "hi", { id: "not-a-live-batch" } as never);
    expect(labels()).toEqual(["add annotation"]);
  });

  it("removeAnnotation drops by id; an unknown id leaves the list alone", () => {
    const id = useApp.getState().addAnnotation(1, 2, "hi");
    useApp.getState().removeAnnotation("ann-nope");
    expect(useApp.getState().annotations).toHaveLength(1);
    useApp.getState().removeAnnotation(id);
    expect(useApp.getState().annotations).toEqual([]);
    expect(labels()).toEqual(["add annotation", "delete annotation", "delete annotation"]);
  });
});

// ── Per-channel styling ────────────────────────────────────────────────────
describe("plot-view settings — series styles, labels and error pairings", () => {
  it("setSeriesStyle merges successive patches on the same channel", () => {
    useApp.getState().setSeriesStyle(1, { color: "#f00" });
    useApp.getState().setSeriesStyle(1, { width: 3 });
    expect(useApp.getState().seriesStyles[1]).toEqual({ color: "#f00", width: 3 });
    expect(labels()).toEqual(["style curve", "style curve"]);
  });

  it("resetSeriesStyle removes one channel's entry, leaving its siblings", () => {
    useApp.getState().setSeriesStyle(0, { color: "#0f0" });
    useApp.getState().setSeriesStyle(1, { color: "#f00" });
    useApp.getState().resetSeriesStyle(1);
    expect(useApp.getState().seriesStyles).toEqual({ 0: { color: "#0f0" } });
  });

  it("resetSeriesStyle on a channel with no style is a no-op that still records", () => {
    useApp.getState().resetSeriesStyle(7);
    expect(useApp.getState().seriesStyles).toEqual({});
    expect(labels()).toEqual(["reset curve style"]);
  });

  it("setSeriesLabel trims, and a blank label CLEARS the override", () => {
    useApp.getState().setSeriesLabel(1, "  moment  ");
    expect(useApp.getState().seriesLabels).toEqual({ 1: "moment" });
    useApp.getState().setSeriesLabel(1, "   ");
    expect(useApp.getState().seriesLabels).toEqual({});
    expect(labels()).toEqual(["rename curve", "rename curve"]);
  });

  it("setErrKey pairs a channel, and null unpairs it", () => {
    useApp.getState().setErrKey(0, 2);
    expect(useApp.getState().errKeys).toEqual({ 0: 2 });
    useApp.getState().setErrKey(0, null);
    expect(useApp.getState().errKeys).toEqual({});
    expect(labels()).toEqual(["change error bars", "change error bars"]);
  });

  it("unpairing a channel that was never paired is a no-op that still records", () => {
    useApp.getState().setErrKey(5, null);
    expect(useApp.getState().errKeys).toEqual({});
    expect(labels()).toEqual(["change error bars"]);
  });
});

// ── Visibility ─────────────────────────────────────────────────────────────
describe("plot-view settings — hidden channels, solo and waterfall", () => {
  it("toggleHidden flips one channel and back", () => {
    useApp.getState().toggleHidden(1);
    expect(useApp.getState().hiddenChannels).toEqual([1]);
    useApp.getState().toggleHidden(1);
    expect(useApp.getState().hiddenChannels).toEqual([]);
    expect(labels()).toEqual(["toggle curve visibility", "toggle curve visibility"]);
  });

  it("soloChannel hides every OTHER plotted channel", () => {
    useApp.setState({ datasets: [ds("d1")], activeId: "d1" });
    useApp.getState().soloChannel(1);
    expect(useApp.getState().hiddenChannels).toEqual([0, 2]);
    expect(labels()).toEqual(["solo curve"]);
  });

  it("soloChannel(null) clears the hidden set outright — no active dataset needed", () => {
    useApp.setState({ hiddenChannels: [0, 2] });
    useApp.getState().soloChannel(null);
    expect(useApp.getState().hiddenChannels).toEqual([]);
  });

  it("soloChannel is a no-op on an empty store (nothing active), entry still pushed", () => {
    useApp.getState().soloChannel(1);
    expect(useApp.getState().hiddenChannels).toEqual([]);
    expect(labels()).toEqual(["solo curve"]);
  });

  it("soloChannel ignores a channel that is not currently plotted", () => {
    useApp.setState({ datasets: [ds("d1")], activeId: "d1", yKeys: [0, 1], hiddenChannels: [] });
    useApp.getState().soloChannel(2);
    expect(useApp.getState().hiddenChannels).toEqual([]);
  });

  it("setWaterfall writes the offset and records a macro step", () => {
    expect(withMacro(() => useApp.getState().setWaterfall(0.25))).toEqual(["qz.setWaterfall(0.25)"]);
    expect(useApp.getState().waterfall).toBe(0.25);
    expect(labels()).toEqual(["change waterfall offset"]);
  });
});

// ── Cross-cutting: what this cluster does NOT do ───────────────────────────
describe("plot-view settings — cluster-wide invariants", () => {
  it("no writer in the cluster touches datasets, status, or the project dirty marker", () => {
    useApp.setState({ datasets: [ds("d1")], activeId: "d1" });
    const datasets = useApp.getState().datasets;
    useApp.getState().setYScale("log");
    useApp.getState().setXLim([0, 1]);
    useApp.getState().setStackMode(true);
    useApp.getState().addRefLine("x", 1);
    useApp.getState().addAnnotation(1, 2, "hi");
    useApp.getState().setSeriesStyle(0, { color: "#f00" });
    useApp.getState().setSeriesLabel(0, "x");
    useApp.getState().setErrKey(0, 1);
    useApp.getState().toggleHidden(0);
    useApp.getState().soloChannel(1);
    useApp.getState().setWaterfall(0.1);
    expect(useApp.getState().datasets).toBe(datasets);
    expect(useApp.getState().status).toBe("");
    expect(useApp.getState().projectDirty).toBe(false);
  });

  it("recording an edit clears the redo stack (recordHistory's contract)", () => {
    useApp.setState({ future: [{ label: "stale", snapshot: {} as never }] });
    useApp.getState().setShowGrid(true);
    expect(useApp.getState().future).toEqual([]);
  });
});
