// Plan item 39: every variant preset equals "choose the parent tile, then set
// the options by hand" through the real store setters, in one undo step.

import { beforeEach, describe, expect, it } from "vitest";

import { setStatMarks, setStatPicks } from "../store/statLevelOptions";
import { useApp } from "../store/useApp";
import { applyPlotPreset, applyPlotType } from "./figureDialogActions";
import * as GLYPHS from "./glyphs";
import { defaultPlotView } from "./plotview";
import { PLOT_PRESETS, plotPresetUnavailable, presetsFor, type PlotPresetId } from "./plotTypePresets";
import { PLOT_TYPES, plotTypeGroups } from "./plotTypes";
import type { Dataset } from "./types";

const ds = (labels: string[]): Dataset => ({
  id: "d",
  name: "d.csv",
  data: { time: [0, 1, 2], values: [[1, 2, 3], [2, 3, 4], [3, 4, 5]].map((r) => r.slice(0, labels.length)), labels, units: labels.map(() => ""), metadata: {} },
});
const app = useApp.getState;

function reset(d: Dataset = ds(["A", "B", "C"])) {
  useApp.setState({ ...defaultPlotView(), datasets: [d], activeId: "d", history: [], future: [], status: "" });
}
const figureState = () => {
  const s = app();
  return { seriesStyles: s.seriesStyles, statMode: s.statMode, polarMode: s.polarMode, statPicks: s.statPicks, statMarks: s.statMarks, y2Keys: s.y2Keys, stageTab: s.stageTab };
};

/** The by-hand route: the parent tile, then each option through its setter. */
const BY_HAND: Record<PlotPresetId, () => void> = {
  stepLine: () => { applyPlotType("line"); for (const ch of [0, 1, 2]) app().setSeriesStyle(ch, { step: "post" }); },
  lineSymbolBand: () => { applyPlotType("lineSymbol"); for (const ch of [0, 1, 2]) app().setSeriesStyle(ch, { errorBar: { band: true } }); },
  splineSymbol: () => { applyPlotType("lineSymbol"); for (const ch of [0, 1, 2]) app().setSeriesStyle(ch, { connect: "spline" }); },
  scatterDropLines: () => { applyPlotType("scatter"); for (const ch of [0, 1, 2]) app().setSeriesStyle(ch, { dropLines: "x" }); },
  stackedPercent: () => { applyPlotType("stackedColumn"); setStatPicks((p) => ({ ...p, barPercent: true })); },
  boxPoints: () => { applyPlotType("box"); setStatMarks("box", { points: "all" }); },
  boxMean: () => { applyPlotType("box"); setStatMarks("box", { summary: "mean", errorBars: "sd" }); },
  violinPoints: () => { applyPlotType("violin"); setStatMarks("violin", { points: "all" }); },
  violinMedian: () => { applyPlotType("violin"); setStatMarks("violin", { summary: "median" }); },
  histogramFit: () => { applyPlotType("histogram"); setStatPicks((p) => ({ ...p, fit: "norm" })); },
  cdfBand: () => { applyPlotType("cdf"); setStatPicks((p) => ({ ...p, cdfBand: true })); },
  cdfPlain: () => { applyPlotType("cdf"); setStatPicks((p) => ({ ...p, cdfBand: false, rug: {} })); },
  cdfRug: () => { applyPlotType("cdf"); setStatPicks((p) => ({ ...p, rug: { on: true } })); },
  marginalBox: () => { applyPlotType("marginal"); setStatPicks((p) => ({ ...p, marginal: "box" })); },
  marginalRug: () => { applyPlotType("marginal"); setStatPicks((p) => ({ ...p, marginal: "rug" })); },
  ridgeOverlap: () => { applyPlotType("ridgeline"); setStatPicks((p) => ({ ...p, ridgeOverlap: 2 })); },
};

beforeEach(() => reset());

describe("variant presets", () => {
  it("ships 8 to 20 presets, each under a real parent, with a registered unique glyph", () => {
    expect(PLOT_PRESETS.length).toBeGreaterThanOrEqual(8);
    expect(PLOT_PRESETS.length).toBeLessThanOrEqual(20);
    const registry = new Set<string>(Object.values(GLYPHS));
    const ids = new Set(PLOT_TYPES.map((t) => t.id));
    const glyphs = [...PLOT_TYPES.map((t) => t.glyph), ...PLOT_PRESETS.map((p) => p.glyph)];
    expect(new Set(glyphs).size).toBe(glyphs.length);
    for (const p of PLOT_PRESETS) {
      expect(ids.has(p.parent), p.id).toBe(true);
      expect(registry.has(p.glyph), p.id).toBe(true);
      expect(p.description.length, p.id).toBeGreaterThan(10);
    }
    expect(new Set(PLOT_PRESETS.map((p) => p.id)).size).toBe(PLOT_PRESETS.length);
    expect(new Set(PLOT_PRESETS.map((p) => p.label)).size).toBe(PLOT_PRESETS.length);
  });

  it("every preset is reachable from some gallery group", () => {
    const shown = plotTypeGroups().flatMap((g) => presetsFor(g.types.map((t) => t.id)).map((p) => p.id));
    expect([...shown].sort()).toEqual(PLOT_PRESETS.map((p) => p.id).sort());
  });

  for (const p of PLOT_PRESETS) {
    it(`${p.id}: equals the ${p.parent} tile plus the options set by hand`, () => {
      applyPlotPreset(p.id);
      const viaPreset = figureState();
      reset();
      BY_HAND[p.id]();
      expect(viaPreset).toEqual(figureState());
    });

    it(`${p.id}: is exactly one undo step`, () => {
      const before = figureState();
      applyPlotPreset(p.id);
      expect(app().history).toHaveLength(1);
      app().undo();
      expect(figureState()).toEqual(before);
    });
  }

  it("a preset differs from its bare parent type", () => {
    for (const p of PLOT_PRESETS) {
      reset();
      applyPlotType(p.parent);
      const bare = figureState();
      reset();
      applyPlotPreset(p.id);
      expect(figureState(), p.id).not.toEqual(bare);
    }
  });

  it("switching between XY presets never leaves the sibling's option on", () => {
    applyPlotPreset("splineSymbol");
    applyPlotPreset("lineSymbolBand");
    expect(app().seriesStyles[0]?.connect).toBeUndefined();
    expect(app().seriesStyles[0]?.errorBar?.band).toBe(true);
    applyPlotPreset("scatterDropLines");
    expect(app().seriesStyles[0]?.errorBar).toBeUndefined();
    expect(app().seriesStyles[0]?.dropLines).toBe("x");
  });

  it("keeps the user's other style fields and the marks of other modes", () => {
    useApp.setState({ seriesStyles: { 0: { color: "#123456", errorBar: { cap: 4 } } }, statMarks: { strip: { points: "none" } } });
    applyPlotPreset("lineSymbolBand");
    expect(app().seriesStyles[0]).toMatchObject({ color: "#123456", errorBar: { cap: 4, band: true } });
    applyPlotPreset("boxPoints");
    expect(app().statMarks).toEqual({ strip: { points: "none" }, box: { points: "all" } });
  });

  it("is unavailable exactly when its parent is, and applying then does nothing", () => {
    expect(plotPresetUnavailable("violinPoints", null)).toMatch(/Select a dataset/);
    expect(plotPresetUnavailable("violinPoints", ds(["A"]))).toBeNull();
    reset();
    useApp.setState({ activeId: null });
    applyPlotPreset("boxPoints");
    expect(app().history).toHaveLength(0);
    expect(app().statMode).toBe(false);
  });
});
