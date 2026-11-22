// The Plot ▸ "Plot type…" gallery's model (figures-audit #8): the plot types
// the existing renderers actually draw, when each is available for the
// active dataset, and the view patch that switches a graph to it. Pure (no
// store import) so every rule is unit-testable; lib/figureDialogActions.ts
// commits.
//
// Where each type renders -- nothing here is a new renderer:
//   Line / Scatter / Line + Symbol / Area  the XY uPlot stage, through the
//                                          per-series style fields the Series
//                                          card already edits (`seriesModePatch`)
//   Column / Stacked column / Box /        the Stat Stage (`statMode`, the
//   Histogram                              `statPicks.mode`/`barStack` picks)
//   Contour / Heatmap                      the Map tab with its contour overlay
//   Violin                                 the Stat Stage, `statPicks.mode` violin
//   Double-Y / Polar                       the XY stage's `y2Keys` / `polarMode`
//   Waterfall / Stacked panels / Ternary   their existing commands (gap-audit-2
//                                          #17: the gallery lists what the app
//                                          draws; `figureDialogActions` routes)

import { seriesModePatch, type SeriesMode } from "./seriesMode";
import * as GLYPHS from "./glyphs";
import { canRenderMap, MAP_GATE_CHECKING, mapGateResolved } from "./mapdata";
import type { PlotView } from "./plotview";
import type { Dataset, SeriesStyle } from "./types";

export type PlotTypeId =
  | "line" | "scatter" | "lineSymbol" | "area"
  | "column" | "stackedColumn" | "columnX" | "barH" | "box" | "histogram"
  | "contour"
  | "violin" | "doubleY" | "polar" | "waterfall" | "stacked" | "ternary";

export interface PlotTypeDef {
  id: PlotTypeId;
  label: string;
  /** A Unicode glyph for the gallery tile (no emoji, design-system rule). */
  glyph: string;
  description: string;
}

export const PLOT_TYPES: readonly PlotTypeDef[] = [
  { id: "line", label: "Line", glyph: GLYPHS.plotLine, description: "Connected lines through every point." },
  { id: "scatter", label: "Scatter", glyph: GLYPHS.plotScatter, description: "Markers only, no connecting line." },
  { id: "lineSymbol", label: "Line + Symbol", glyph: GLYPHS.plotLineSymbol, description: "Connected lines with a marker at each point." },
  { id: "area", label: "Area", glyph: GLYPHS.plotArea, description: "Lines filled down to zero." },
  { id: "column", label: "Column / Bar", glyph: GLYPHS.plotColumn, description: "One bar per category (the X column's levels), side by side per series." },
  { id: "stackedColumn", label: "Stacked Column", glyph: GLYPHS.plotStackedColumn, description: "Bars stacked per category, one segment per series." },
  { id: "columnX", label: "Column per X row", glyph: GLYPHS.plotColumnX, description: "One bar per row at its X value, one series per Y column; the Series card colour fills the bars." },
  { id: "barH", label: "Horizontal Bar", glyph: GLYPHS.plotBarH, description: "Bars from zero at each X, turned on their side (X up the left axis)." },
  { id: "box", label: "Box", glyph: GLYPHS.plotBox, description: "Box-and-whisker per category." },
  { id: "histogram", label: "Histogram", glyph: GLYPHS.plotHistogram, description: "Distribution of one column's values." },
  { id: "contour", label: "Contour / Heatmap", glyph: GLYPHS.plotContour, description: "Colour map with contour lines from X/Y/Z columns." },
  { id: "violin", label: "Violin", glyph: GLYPHS.plotViolin, description: "Distribution shape per category, mirrored." },
  { id: "doubleY", label: "Double-Y", glyph: GLYPHS.plotDoubleY, description: "The last plotted column on a second Y axis at the right." },
  { id: "polar", label: "Polar", glyph: GLYPHS.plotPolar, description: "Angle (X, degrees) against radius (Y)." },
  { id: "waterfall", label: "Waterfall", glyph: GLYPHS.plotWaterfall, description: "Curves offset vertically so overlapping traces separate." },
  { id: "stacked", label: "Stacked panels", glyph: GLYPHS.stackedPanels, description: "Each curve in its own panel, sharing one X axis." },
  { id: "ternary", label: "Ternary", glyph: GLYPHS.plotTernary, description: "Three composition columns on a triangle." },
];

/** Types that open an existing tool rather than restyle the graph. */
export const PLOT_TYPE_COMMANDS: ReadonlySet<PlotTypeId> = new Set(["waterfall", "stacked", "ternary"]);

/** Why a type cannot draw this dataset, or null when it can. */
export function plotTypeUnavailable(id: PlotTypeId, dataset: Dataset | null): string | null {
  if (!dataset) return "Select a dataset first.";
  if (id === "contour" && !canRenderMap(dataset.data)) {
    // The grid gate is lazy (lib/mapdata.ts): before it has run, "no" means
    // "not known yet", never "unavailable" (the gallery warms it and re-renders).
    if (!mapGateResolved(dataset.data)) return MAP_GATE_CHECKING;
    return "Needs X, Y, Z on a grid; else Plot > Contour from scattered XYZ.";
  }
  const columns = dataset.data.labels.length;
  if ((id === "doubleY" || id === "waterfall" || id === "stacked") && columns < 2) return "Needs at least two Y columns.";
  if (id === "ternary" && columns < 3) return "Needs three composition columns.";
  return null;
}

const XY_MODE: Partial<Record<PlotTypeId, SeriesMode>> = {
  line: "line",
  scatter: "scatter",
  lineSymbol: "lineSymbol",
  area: "line",
  columnX: "line",
  barH: "line",
};

/** The view patch for an XY or Stat Stage type (contour switches tabs
 *  instead -- the caller handles it). `plotted` are the graph's plotted
 *  channels; only their styles change. */
export function plotTypePatch(
  id: PlotTypeId,
  view: Pick<PlotView, "seriesStyles" | "statPicks">,
  plotted: readonly number[],
): Partial<PlotView> {
  if (id === "polar") return { statMode: false, polarMode: true };
  // The last plotted column moves to the right axis (Origin's Double-Y).
  if (id === "doubleY") return { statMode: false, polarMode: false, y2Keys: plotted.length > 1 ? [plotted[plotted.length - 1]] : null };
  const mode = XY_MODE[id];
  if (mode) {
    const seriesStyles: Record<number, SeriesStyle> = { ...view.seriesStyles };
    for (const ch of plotted) {
      const current = seriesStyles[ch] ?? {};
      const next: SeriesStyle = { ...current, ...seriesModePatch(mode, current) };
      if (id === "area") next.fill = "under";
      else if (next.fill === "under") delete next.fill;
      // Bar types draw bars from zero (their fill is the bars' own); every
      // other XY type leaves bar mode, so Column per X row -> Line switches.
      if (id === "columnX" || id === "barH") {
        next.bars = id === "barH" ? "horizontal" : true;
        delete next.fill;
        next.marker = false;
      } else delete next.bars;
      seriesStyles[ch] = next;
    }
    return { statMode: false, polarMode: false, seriesStyles };
  }
  const statMode = id === "column" || id === "stackedColumn" ? "bar" : id === "box" ? "box" : id === "violin" ? "violin" : "histogram";
  return {
    statMode: true,
    polarMode: false,
    statPicks: {
      ...view.statPicks,
      mode: statMode,
      ...(statMode === "bar" ? { barStack: id === "stackedColumn" } : {}),
    },
  };
}
