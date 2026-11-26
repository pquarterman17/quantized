// The plot-type gallery's VARIANT presets (plan item 39, Origin's "Violin
// with Point", "Box + Data", "Histogram + Distribution" tiles): a preset is an
// existing plot type PLUS a fixed set of that type's existing options, so the
// options are found without a dialog. Nothing here renders anything new:
// every preset is exactly "choose the parent tile, then set these options by
// hand" (tested as an equivalence against the real store setters). Pure, no
// store import; lib/figureDialogActions.ts commits it as one undo step.

import * as GLYPHS from "./glyphs";
import { seriesModePatch } from "./seriesMode";
import { plotTypePatch, plotTypeUnavailable, type PlotTypeId } from "./plotTypes";
import type { PlotView } from "./plotview";
import type { StatMarks, StatMarksMode, StatPicks } from "./plotviewSanitize";
import type { Dataset, SeriesStyle } from "./types";

export type PlotPresetId =
  | "violinPoints" | "violinMedian" | "boxPoints" | "boxMean" | "histogramFit"
  | "stackedPercent" | "lineSymbolBand" | "scatterDropLines" | "splineSymbol" | "stepLine"
  | "cdfBand" | "cdfPlain" | "cdfRug" | "marginalBox" | "marginalRug" | "ridgeOverlap"
  | "splitViolin" | "pairedCi" | "lollipopSorted" | "stackedHist";

export interface PlotPresetDef {
  id: PlotPresetId;
  /** The plot type this is a variant of; availability follows it. */
  parent: PlotTypeId;
  label: string;
  /** A Unicode glyph (no emoji), registered in lib/glyphs.ts. */
  glyph: string;
  description: string;
}

export const PLOT_PRESETS: readonly PlotPresetDef[] = [
  { id: "stepLine", parent: "line", label: "Step line", glyph: GLYPHS.presetStep, description: "Line drawn as steps that hold each value until the next X." },
  { id: "lineSymbolBand", parent: "lineSymbol", label: "Line + error band", glyph: GLYPHS.presetErrorBand, description: "Line and symbols, with the bound error column shaded as a band instead of bars." },
  { id: "splineSymbol", parent: "lineSymbol", label: "Spline + symbol", glyph: GLYPHS.presetSpline, description: "Symbols joined by a smooth cubic spline (X ascending)." },
  { id: "scatterDropLines", parent: "scatter", label: "Scatter + drop lines", glyph: GLYPHS.presetDropLines, description: "Markers with a line from each point down to the X axis." },
  { id: "stackedPercent", parent: "stackedColumn", label: "100% stacked column", glyph: GLYPHS.presetStackedPercent, description: "Stacked bars normalised to 100% per category." },
  { id: "boxPoints", parent: "box", label: "Box + data points", glyph: GLYPHS.presetBoxPoints, description: "Box-and-whisker with every raw point jittered over it." },
  { id: "boxMean", parent: "box", label: "Box + mean ± SD", glyph: GLYPHS.presetBoxMean, description: "Box-and-whisker with the mean marked and its SD bar." },
  { id: "violinPoints", parent: "violin", label: "Violin + points", glyph: GLYPHS.presetViolinPoints, description: "Violin with every raw point jittered over it." },
  { id: "violinMedian", parent: "violin", label: "Violin + median", glyph: GLYPHS.presetViolinMedian, description: "Violin with the median marked on each shape." },
  { id: "histogramFit", parent: "histogram", label: "Histogram + normal fit", glyph: GLYPHS.presetHistogramFit, description: "Histogram with a fitted normal curve drawn over it." },
  { id: "cdfBand", parent: "cdf", label: "CDF + 95% band", glyph: GLYPHS.presetCdfBand, description: "Steps with the 95% DKW confidence band." },
  { id: "cdfPlain", parent: "cdf", label: "CDF, steps only", glyph: GLYPHS.presetCdfPlain, description: "Steps alone: band and rug off." },
  { id: "cdfRug", parent: "cdf", label: "CDF + rug", glyph: GLYPHS.presetCdfRug, description: "Steps with a tick for every value." },
  { id: "marginalBox", parent: "marginal", label: "Scatter + box margins", glyph: GLYPHS.presetMarginalBox, description: "Box plots on the top and right." },
  { id: "marginalRug", parent: "marginal", label: "Scatter + rug margins", glyph: GLYPHS.presetMarginalRug, description: "A tick per point on the top and right." },
  { id: "ridgeOverlap", parent: "ridgeline", label: "Overlapping ridgeline", glyph: GLYPHS.presetRidgeOverlap, description: "Ridges overlap by twice their spacing." },
  { id: "splitViolin", parent: "sideViolin", label: "Split violin", glyph: GLYPHS.presetSplitViolin, description: "Two levels of the second factor back to back." },
  { id: "pairedCi", parent: "paired", label: "Paired + mean ± 95% CI", glyph: GLYPHS.presetPairedCi, description: "Each side's mean with its confidence interval." },
  { id: "lollipopSorted", parent: "lollipop", label: "Lollipop, sorted", glyph: GLYPHS.presetLollipopSorted, description: "Largest value first." },
  { id: "stackedHist", parent: "histogram", label: "Stacked histogram", glyph: GLYPHS.presetStackedHist, description: "Columns stacked on shared bins." },
];

/** The presets under each of `parents`, in declaration order. */
export function presetsFor(parents: readonly PlotTypeId[]): PlotPresetDef[] {
  return PLOT_PRESETS.filter((p) => parents.includes(p.parent));
}

/** Why a preset cannot draw this dataset, or null: its parent's rule. */
export function plotPresetUnavailable(id: PlotPresetId, dataset: Dataset | null): string | null {
  const p = PLOT_PRESETS.find((x) => x.id === id);
  return p ? plotTypeUnavailable(p.parent, dataset) : "Unknown preset.";
}

/** Stat Stage presets: the mode's marks bucket and/or the picks they set. */
const STAT_MARKS: Partial<Record<PlotPresetId, { mode: StatMarksMode; marks: StatMarks }>> = {
  boxPoints: { mode: "box", marks: { points: "all" } },
  boxMean: { mode: "box", marks: { summary: "mean", errorBars: "sd" } },
  violinPoints: { mode: "violin", marks: { points: "all" } },
  violinMedian: { mode: "violin", marks: { summary: "median" } },
};
const STAT_PICKS: Partial<Record<PlotPresetId, Partial<StatPicks>>> = {
  histogramFit: { fit: "norm" },
  stackedPercent: { barPercent: true },
  cdfBand: { cdfBand: true },
  cdfPlain: { cdfBand: false, rug: {} },
  cdfRug: { rug: { on: true } },
  marginalBox: { marginal: "box" },
  marginalRug: { marginal: "rug" },
  ridgeOverlap: { ridgeOverlap: 2 },
  splitViolin: { violinSide: "split" },
  pairedCi: { pairedCi: true },
  lollipopSorted: { lollipopSort: "desc" },
  stackedHist: { histStack: true },
};

/** Every XY style field a preset owns: cleared first, so switching from one
 *  XY preset to another never leaves the sibling's option on. A plain tile does
 *  NOT clear these (existing tile behaviour is unchanged), so a preset's option
 *  survives a later click on its parent's plain tile; likewise the Stat Stage
 *  presets' picks and marks. */
function withoutPresetFields(style: SeriesStyle): SeriesStyle {
  const next: SeriesStyle = { ...style };
  delete next.connect;
  delete next.dropLines;
  if (next.errorBar?.band) {
    const { band: _band, ...rest } = next.errorBar;
    if (Object.keys(rest).length) next.errorBar = rest;
    else delete next.errorBar;
  }
  return next;
}

const XY_EXTRA: Partial<Record<PlotPresetId, (s: SeriesStyle) => SeriesStyle>> = {
  stepLine: (s) => ({ ...s, ...seriesModePatch("step", s) }),
  lineSymbolBand: (s) => ({ ...s, errorBar: { ...s.errorBar, band: true } }),
  splineSymbol: (s) => ({ ...s, connect: "spline" }),
  scatterDropLines: (s) => ({ ...s, dropLines: "x" }),
};

/** The view patch for a preset: its parent's `plotTypePatch` with the preset's
 *  options layered on, as ONE patch (the caller commits one undo step). */
export function plotPresetPatch(
  id: PlotPresetId,
  view: Pick<PlotView, "seriesStyles" | "statPicks" | "statMarks">,
  plotted: readonly number[],
): Partial<PlotView> {
  const def = PLOT_PRESETS.find((p) => p.id === id);
  if (!def) return {};
  const inputStyles: Record<number, SeriesStyle> = { ...view.seriesStyles };
  const xy = XY_EXTRA[id];
  // An XY preset starts from a clean slate of preset-owned fields.
  if (xy) for (const ch of plotted) if (inputStyles[ch]) inputStyles[ch] = withoutPresetFields(inputStyles[ch]);
  const base = plotTypePatch(def.parent, { seriesStyles: inputStyles, statPicks: view.statPicks }, plotted);
  const patch: Partial<PlotView> = { ...base };
  if (xy && base.seriesStyles) {
    const seriesStyles = { ...base.seriesStyles };
    for (const ch of plotted) seriesStyles[ch] = xy(seriesStyles[ch] ?? {});
    patch.seriesStyles = seriesStyles;
  }
  const picks = STAT_PICKS[id];
  if (picks) patch.statPicks = { ...base.statPicks, ...picks };
  const marks = STAT_MARKS[id];
  if (marks) patch.statMarks = { ...view.statMarks, [marks.mode]: { ...view.statMarks[marks.mode], ...marks.marks } };
  return patch;
}
