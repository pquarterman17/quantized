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

import { seriesModePatch, type SeriesMode } from "./seriesMode";
import { canRenderMap } from "./mapdata";
import type { PlotView } from "./plotview";
import type { Dataset, SeriesStyle } from "./types";

export type PlotTypeId =
  | "line" | "scatter" | "lineSymbol" | "area"
  | "column" | "stackedColumn" | "box" | "histogram"
  | "contour";

export interface PlotTypeDef {
  id: PlotTypeId;
  label: string;
  /** A Unicode glyph for the gallery tile (no emoji, design-system rule). */
  glyph: string;
  description: string;
}

export const PLOT_TYPES: readonly PlotTypeDef[] = [
  { id: "line", label: "Line", glyph: "╱", description: "Connected lines through every point." },
  { id: "scatter", label: "Scatter", glyph: "∴", description: "Markers only, no connecting line." },
  { id: "lineSymbol", label: "Line + Symbol", glyph: "⟋", description: "Connected lines with a marker at each point." },
  { id: "area", label: "Area", glyph: "◢", description: "Lines filled down to zero." },
  { id: "column", label: "Column / Bar", glyph: "▥", description: "One bar per category (the X column's levels), side by side per series." },
  { id: "stackedColumn", label: "Stacked Column", glyph: "▤", description: "Bars stacked per category, one segment per series." },
  { id: "box", label: "Box", glyph: "◫", description: "Box-and-whisker per category." },
  { id: "histogram", label: "Histogram", glyph: "▇", description: "Distribution of one column's values." },
  { id: "contour", label: "Contour / Heatmap", glyph: "◎", description: "Colour map with contour lines from X/Y/Z columns." },
];

/** Why a type cannot draw this dataset, or null when it can. */
export function plotTypeUnavailable(id: PlotTypeId, dataset: Dataset | null): string | null {
  if (!dataset) return "Select a dataset first.";
  if (id === "contour" && !canRenderMap(dataset.data)) {
    return "Needs X, Y and Z columns on a grid (long-form XYZ), e.g. X,Y,Z.";
  }
  return null;
}

const XY_MODE: Partial<Record<PlotTypeId, SeriesMode>> = {
  line: "line",
  scatter: "scatter",
  lineSymbol: "lineSymbol",
  area: "line",
};

/** The view patch for an XY or Stat Stage type (contour switches tabs
 *  instead -- the caller handles it). `plotted` are the graph's plotted
 *  channels; only their styles change. */
export function plotTypePatch(
  id: PlotTypeId,
  view: Pick<PlotView, "seriesStyles" | "statPicks">,
  plotted: readonly number[],
): Partial<PlotView> {
  const mode = XY_MODE[id];
  if (mode) {
    const seriesStyles: Record<number, SeriesStyle> = { ...view.seriesStyles };
    for (const ch of plotted) {
      const current = seriesStyles[ch] ?? {};
      const next: SeriesStyle = { ...current, ...seriesModePatch(mode, current) };
      if (id === "area") next.fill = "under";
      else if (next.fill === "under") delete next.fill;
      seriesStyles[ch] = next;
    }
    return { statMode: false, seriesStyles };
  }
  const statMode = id === "column" || id === "stackedColumn" ? "bar" : id === "box" ? "box" : "histogram";
  return {
    statMode: true,
    statPicks: {
      ...view.statPicks,
      mode: statMode,
      ...(statMode === "bar" ? { barStack: id === "stackedColumn" } : {}),
    },
  };
}
