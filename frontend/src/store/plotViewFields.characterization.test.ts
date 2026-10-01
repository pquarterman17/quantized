// Characterization tests for the PLOTVIEW FIELDS domain (audit P4.1, the
// TENTH store/useApp.ts domain): the focused window's live PlotView fields
// on the singleton store (yScale … waterfall), declared and initialized in
// one place. Their writers are store/plotViewSettings.ts's actions and are
// pinned by that module's own characterization file; this one pins the
// FIELDS — that every one exists on the composed store, the exact initial
// value of each, and the one prefs dependency (`showGrid` is seeded from the
// persisted `defaultGrid` preference at store creation).
//
// The windowing facade depends on the first two: `snapshotView` reads every
// PlotView key off the store, so a field left off the store (a slice not
// spread in) would freeze `undefined` into every window record, and the
// first window must be indistinguishable from `defaultPlotView()`
// (MULTI_PLOT_PLAN decision #6).
//
// Written and run GREEN against the pre-extraction useApp.ts; it imports the
// store only through `./useApp` (plus lib/plotview, which does not move), so
// nothing here may change when the domain moves out.

import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultPlotView, snapshotView } from "../lib/plotview";
import { useApp } from "./useApp";

// Every field this domain declares, with its initial value. `showGrid` is
// left out: it follows the persisted `defaultGrid` pref (tested below).
const INITIAL = {
  yScale: "linear",
  xScale: "linear",
  showLegend: true,
  legendPos: "ne",
  legendStatic: false,
  legendTitle: null,
  plotTemplate: "screen",
  showAxisBox: true,
  stackMode: false,
  panelFit: "frames",
  pageSetup: null,
  composition: null,
  insetMode: false,
  polarMode: false,
  statMode: false,
  statHideEmptyLevels: false,
  statShowGroupN: true,
  statShowSummary: false,
  statMarks: {},
  statPicks: {},
  xLim: null,
  yLim: null,
  xStep: null,
  yStep: null,
  xFmt: { mode: "auto", digits: 2 },
  yFmt: { mode: "auto", digits: 2 },
  y2Fmt: null,
  plotTitle: "",
  xAxisLabel: "",
  yAxisLabel: "",
  xKey: null,
  yKeys: null,
  groupKey: null,
  facetKey: null,
  y2Keys: null,
  y2Lim: null,
  y2Scale: null,
  y2Step: null,
  y2AxisLabel: "",
  refLines: [],
  annotations: [],
  seriesStyles: {},
  seriesLabels: {},
  errKeys: {},
  seriesOrder: null,
  hiddenChannels: [],
  waterfall: 0,
};

afterEach(() => {
  localStorage.removeItem("qz.prefs");
  vi.resetModules();
});

describe("PlotView fields: initial state", () => {
  it("every field starts at its pinned initial value", () => {
    const s = useApp.getInitialState() as unknown as Record<string, unknown>;
    const got = Object.fromEntries(Object.keys(INITIAL).map((k) => [k, s[k]]));
    expect(got).toEqual(INITIAL);
  });

  it("showGrid starts at the defaultGrid pref", () => {
    const s = useApp.getInitialState();
    expect(s.showGrid).toBe(s.defaultGrid);
  });

  it("every PlotView key is present on the store, so snapshotView never reads undefined", () => {
    const s = useApp.getInitialState() as unknown as Record<string, unknown>;
    const missing = Object.keys(defaultPlotView()).filter((k) => !(k in s) || s[k] === undefined);
    expect(missing).toEqual([]);
  });

  it("the initial live view IS defaultPlotView() (showGrid aside) — the first window matches 'no windows yet'", () => {
    const s = useApp.getInitialState();
    expect(snapshotView(s)).toEqual({ ...defaultPlotView(), showGrid: s.defaultGrid });
  });
});

describe("PlotView fields: the defaultGrid seed", () => {
  it("a persisted defaultGrid=false starts the store with the grid OFF", async () => {
    localStorage.setItem("qz.prefs", JSON.stringify({ defaultGrid: false }));
    vi.resetModules();
    const fresh = (await import("./useApp")).useApp.getInitialState();
    expect(fresh.defaultGrid).toBe(false);
    expect(fresh.showGrid).toBe(false);
  });

  it("a persisted defaultGrid=true starts the store with the grid ON", async () => {
    localStorage.setItem("qz.prefs", JSON.stringify({ defaultGrid: true }));
    vi.resetModules();
    const fresh = (await import("./useApp")).useApp.getInitialState();
    expect(fresh.showGrid).toBe(true);
  });
});
